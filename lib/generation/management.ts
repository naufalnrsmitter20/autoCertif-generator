import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";
import { inngest } from "@/lib/inngest/client";
import { validateRenderingPrerequisites } from "./preflight";
import {
  BatchNotEligibleForGenerationError,
  ConcurrentGenerationConflictError,
} from "./errors";
import { BatchNotFoundError } from "@/lib/batches";
import type {
  ManagementCertificateRow,
  BatchGenerationManagementData,
} from "./types";
export type {
  ManagementCertificateRow,
  BatchGenerationManagementData,
};

/**
 * Fetch generation management query data for an active batch:
 * - Summary counts across active certificates
 * - Participant rows with safe failure messages and output flags
 * - Excludes all internal storage paths, signed tokens, and credentials
 */
export async function getBatchGenerationManagementData(
  batchId: string
): Promise<BatchGenerationManagementData> {
  await requireAdmin();

  const batch = await prisma.certificateBatch.findFirst({
    where: {
      id: batchId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      status: true,
      currentGenerationKey: true,
      updatedAt: true,
    },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  const participants = await prisma.participant.findMany({
    where: {
      batchId,
      deletedAt: null,
    },
    include: {
      certificate: {
        where: {
          deletedAt: null,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const summary = {
    total: participants.length,
    pending: 0,
    generating: 0,
    generated: 0,
    failed: 0,
    stale: 0,
  };

  const participantRows: ManagementCertificateRow[] = participants.map((p) => {
    const cert = p.certificate;
    if (!cert) {
      return {
        participantId: p.id,
        name: p.name,
        certificateId: null,
        certificateStatus: "UNINITIALIZED" as const,
        safeGenerationError: null,
        generatedAt: null,
        hasPreviousOutput: false,
        isStale: false,
      };
    }

    if (cert.status === CertificateStatus.PENDING) summary.pending++;
    else if (cert.status === CertificateStatus.GENERATING) summary.generating++;
    else if (cert.status === CertificateStatus.GENERATED) summary.generated++;
    else if (cert.status === CertificateStatus.FAILED) summary.failed++;

    if (cert.isStale) summary.stale++;

    return {
      participantId: p.id,
      name: p.name,
      certificateId: cert.id,
      certificateStatus: cert.status,
      safeGenerationError: cert.generationError,
      generatedAt: cert.generatedAt ? cert.generatedAt.toISOString() : null,
      hasPreviousOutput: cert.generatedFilePath !== null,
      isStale: cert.isStale,
    };
  });

  return {
    batch: {
      id: batch.id,
      name: batch.name,
      status: batch.status,
      currentGenerationKey: batch.currentGenerationKey,
      updatedAt: batch.updatedAt.toISOString(),
    },
    summary,
    participants: participantRows,
  };
}

/**
 * Retry generation for a single FAILED participant certificate.
 * Business contract:
 * - Batch status must be GENERATED.
 * - Target Certificate status must be FAILED.
 * - expectedCurrentGenerationKey must match batch.currentGenerationKey.
 */
export async function retryParticipantGeneration(
  batchId: string,
  participantId: string,
  expectedCurrentGenerationKey: string | null
): Promise<{ generationKey: string; certificateId: string }> {
  await requireAdmin();

  // 1. Precondition checks on batch
  const batch = await prisma.certificateBatch.findFirst({
    where: { id: batchId, deletedAt: null },
    select: { id: true, status: true, currentGenerationKey: true },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.status !== BatchStatus.GENERATED) {
    throw new BatchNotEligibleForGenerationError(
      `Batch is in "${batch.status}" status. Participant retry is only permitted when batch status is GENERATED.`
    );
  }

  if (batch.currentGenerationKey !== expectedCurrentGenerationKey) {
    throw new ConcurrentGenerationConflictError(
      "Generation identity is stale or batch state changed. Please refresh and try again."
    );
  }

  // 2. Precondition check on participant & certificate
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, batchId, deletedAt: null },
    include: {
      certificate: {
        where: { deletedAt: null },
      },
    },
  });

  if (!participant || !participant.certificate) {
    throw new BatchNotEligibleForGenerationError(
      "Participant or certificate not found for retry."
    );
  }

  if (participant.certificate.status !== CertificateStatus.FAILED) {
    throw new BatchNotEligibleForGenerationError(
      `Certificate is in "${participant.certificate.status}" status. Retry is only permitted for FAILED certificates.`
    );
  }

  // 3. Shared rendering prerequisites check
  await validateRenderingPrerequisites(batchId, [participantId]);

  // 4. Generate fresh generationKey
  const newGenerationKey = crypto.randomUUID();
  const certId = participant.certificate.id;

  // 5. Atomic CAS transaction
  await prisma.$transaction(async (tx) => {
    // CAS update on batch
    const batchUpdate = await tx.certificateBatch.updateMany({
      where: {
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: expectedCurrentGenerationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATING,
        currentGenerationKey: newGenerationKey,
      },
    });

    if (batchUpdate.count !== 1) {
      throw new ConcurrentGenerationConflictError(
        "Concurrent generation request or batch status changed during retry initialization."
      );
    }

    // Re-verify certificate status in transaction
    const txCert = await tx.certificate.findFirst({
      where: {
        id: certId,
        status: CertificateStatus.FAILED,
        deletedAt: null,
      },
    });

    if (!txCert) {
      throw new ConcurrentGenerationConflictError(
        "Certificate status changed concurrently during retry initialization."
      );
    }

    // Update target certificate: PENDING, fresh generationKey, clear error
    // Preserve existing generatedFilePath and generatedAt if present, set isStale = true
    await tx.certificate.update({
      where: { id: certId },
      data: {
        status: CertificateStatus.PENDING,
        generationKey: newGenerationKey,
        generationError: null,
        isStale: txCert.generatedFilePath !== null,
      },
    });
  });

  // 6. Enqueue batch orchestrator event (fans out only target certificate)
  await inngest.send({
    name: "autocertif/generation.batch.requested",
    id: `gen-batch-${batchId}-${newGenerationKey}`,
    data: {
      batchId,
      generationKey: newGenerationKey,
    },
  });

  return {
    generationKey: newGenerationKey,
    certificateId: certId,
  };
}

/**
 * Regenerate a single GENERATED participant certificate.
 * Business contract:
 * - Batch status must be GENERATED.
 * - Target Certificate status must be GENERATED.
 * - expectedCurrentGenerationKey must match batch.currentGenerationKey.
 */
export async function regenerateParticipantGeneration(
  batchId: string,
  participantId: string,
  expectedCurrentGenerationKey: string | null
): Promise<{ generationKey: string; certificateId: string }> {
  await requireAdmin();

  // 1. Precondition checks on batch
  const batch = await prisma.certificateBatch.findFirst({
    where: { id: batchId, deletedAt: null },
    select: { id: true, status: true, currentGenerationKey: true },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.status !== BatchStatus.GENERATED) {
    throw new BatchNotEligibleForGenerationError(
      `Batch is in "${batch.status}" status. Participant regeneration is only permitted when batch status is GENERATED.`
    );
  }

  if (batch.currentGenerationKey !== expectedCurrentGenerationKey) {
    throw new ConcurrentGenerationConflictError(
      "Generation identity is stale or batch state changed. Please refresh and try again."
    );
  }

  // 2. Precondition check on participant & certificate
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, batchId, deletedAt: null },
    include: {
      certificate: {
        where: { deletedAt: null },
      },
    },
  });

  if (!participant || !participant.certificate) {
    throw new BatchNotEligibleForGenerationError(
      "Participant or certificate not found for regeneration."
    );
  }

  if (participant.certificate.status !== CertificateStatus.GENERATED) {
    throw new BatchNotEligibleForGenerationError(
      `Certificate is in "${participant.certificate.status}" status. Regenerate is only permitted for GENERATED certificates.`
    );
  }

  // 3. Shared rendering prerequisites check
  await validateRenderingPrerequisites(batchId, [participantId]);

  // 4. Generate fresh generationKey
  const newGenerationKey = crypto.randomUUID();
  const certId = participant.certificate.id;

  // 5. Atomic CAS transaction
  await prisma.$transaction(async (tx) => {
    // CAS update on batch
    const batchUpdate = await tx.certificateBatch.updateMany({
      where: {
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: expectedCurrentGenerationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATING,
        currentGenerationKey: newGenerationKey,
      },
    });

    if (batchUpdate.count !== 1) {
      throw new ConcurrentGenerationConflictError(
        "Concurrent generation request or batch status changed during regeneration initialization."
      );
    }

    // Re-verify certificate status in transaction
    const txCert = await tx.certificate.findFirst({
      where: {
        id: certId,
        status: CertificateStatus.GENERATED,
        deletedAt: null,
      },
    });

    if (!txCert) {
      throw new ConcurrentGenerationConflictError(
        "Certificate status changed concurrently during regeneration initialization."
      );
    }

    // Update target certificate: PENDING, fresh generationKey, clear error, set isStale = true
    // Preserves existing generatedFilePath and generatedAt until replacement succeeds
    await tx.certificate.update({
      where: { id: certId },
      data: {
        status: CertificateStatus.PENDING,
        generationKey: newGenerationKey,
        generationError: null,
        isStale: true,
      },
    });
  });

  // 6. Enqueue batch orchestrator event
  await inngest.send({
    name: "autocertif/generation.batch.requested",
    id: `gen-batch-${batchId}-${newGenerationKey}`,
    data: {
      batchId,
      generationKey: newGenerationKey,
    },
  });

  return {
    generationKey: newGenerationKey,
    certificateId: certId,
  };
}

/**
 * Whole-batch regeneration.
 * Business contract:
 * - Batch status must be GENERATED.
 * - expectedCurrentGenerationKey must match batch.currentGenerationKey.
 * - All active participant certificates are transitioned to PENDING with a fresh generationKey.
 * - Existing outputs are preserved with isStale = true.
 */
export async function regenerateBatchGeneration(
  batchId: string,
  expectedCurrentGenerationKey: string | null
): Promise<{ generationKey: string; participantCount: number }> {
  await requireAdmin();

  // 1. Precondition checks on batch
  const batch = await prisma.certificateBatch.findFirst({
    where: { id: batchId, deletedAt: null },
    select: { id: true, status: true, currentGenerationKey: true },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.status !== BatchStatus.GENERATED) {
    throw new BatchNotEligibleForGenerationError(
      `Batch is in "${batch.status}" status. Batch regeneration is only permitted when batch status is GENERATED.`
    );
  }

  if (batch.currentGenerationKey !== expectedCurrentGenerationKey) {
    throw new ConcurrentGenerationConflictError(
      "Generation identity is stale or batch state changed. Please refresh and try again."
    );
  }

  // 2. Validate shared rendering prerequisites for all active participants
  const snapshot = await validateRenderingPrerequisites(batchId);

  // 3. Generate fresh generationKey
  const newGenerationKey = crypto.randomUUID();

  // 4. Atomic CAS transaction
  await prisma.$transaction(async (tx) => {
    // CAS update on batch
    const batchUpdate = await tx.certificateBatch.updateMany({
      where: {
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: expectedCurrentGenerationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATING,
        currentGenerationKey: newGenerationKey,
      },
    });

    if (batchUpdate.count !== 1) {
      throw new ConcurrentGenerationConflictError(
        "Concurrent generation request or batch status changed during batch regeneration initialization."
      );
    }

    // Load active certificates
    const certificates = await tx.certificate.findMany({
      where: {
        batchId,
        deletedAt: null,
      },
    });

    for (const cert of certificates) {
      await tx.certificate.update({
        where: { id: cert.id },
        data: {
          status: CertificateStatus.PENDING,
          generationKey: newGenerationKey,
          generationError: null,
          isStale: cert.generatedFilePath !== null,
        },
      });
    }
  });

  // 5. Enqueue orchestrator event
  await inngest.send({
    name: "autocertif/generation.batch.requested",
    id: `gen-batch-${batchId}-${newGenerationKey}`,
    data: {
      batchId,
      generationKey: newGenerationKey,
    },
  });

  return {
    generationKey: newGenerationKey,
    participantCount: snapshot.activeParticipants.length,
  };
}

/**
 * Safe recovery for a BatchStatus.FAILED batch.
 * Business contract:
 * - Batch status must be FAILED.
 * - expectedCurrentGenerationKey must match batch.currentGenerationKey.
 * - Target recovery set is strictly scoped to unfinished Certificates (PENDING or GENERATING)
 *   belonging to the failed operation (generationKey == batch.currentGenerationKey).
 * - Already-terminal certificates from this or prior operations are NOT touched or regenerated.
 * - If zero unfinished certificates remain, safely reconciles batch to GENERATED without fan-out.
 */
export async function recoverFailedBatchGeneration(
  batchId: string,
  expectedCurrentGenerationKey: string | null
): Promise<
  | { reconciled: true; recoveredCount: 0 }
  | { reconciled: false; generationKey: string; recoveredCount: number }
> {
  await requireAdmin();

  // 1. Precondition checks on batch
  const batch = await prisma.certificateBatch.findFirst({
    where: { id: batchId, deletedAt: null },
    select: { id: true, status: true, currentGenerationKey: true },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.status !== BatchStatus.FAILED) {
    throw new BatchNotEligibleForGenerationError(
      `Batch is in "${batch.status}" status. Recovery is only permitted for FAILED batches.`
    );
  }

  if (batch.currentGenerationKey !== expectedCurrentGenerationKey) {
    throw new ConcurrentGenerationConflictError(
      "Generation identity is stale or batch was already recovered. Please refresh and try again."
    );
  }

  const failedGenerationKey = batch.currentGenerationKey;
  if (!failedGenerationKey) {
    throw new BatchNotEligibleForGenerationError(
      "No current generation identity recorded for failed batch."
    );
  }

  // 2. Query unfinished certificates belonging to failed operation
  const unfinishedCerts = await prisma.certificate.findMany({
    where: {
      batchId,
      generationKey: failedGenerationKey,
      deletedAt: null,
      status: {
        in: [CertificateStatus.PENDING, CertificateStatus.GENERATING],
      },
    },
  });

  // 3. If zero unfinished certificates remain: all had reached terminal state before batch failed.
  // Safely reconcile batch status to GENERATED without fan-out.
  if (unfinishedCerts.length === 0) {
    const reconcileResult = await prisma.certificateBatch.updateMany({
      where: {
        id: batchId,
        status: BatchStatus.FAILED,
        currentGenerationKey: expectedCurrentGenerationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATED,
      },
    });

    if (reconcileResult.count !== 1) {
      throw new ConcurrentGenerationConflictError(
        "Batch state changed concurrently during reconciliation."
      );
    }

    return { reconciled: true, recoveredCount: 0 };
  }

  // 4. Validate shared rendering prerequisites for only the unfinished participants
  const targetParticipantIds = unfinishedCerts.map((c) => c.participantId);
  await validateRenderingPrerequisites(batchId, targetParticipantIds);

  // 5. Generate fresh recovery generationKey
  const recoveryKey = crypto.randomUUID();

  // 6. Atomic CAS transaction
  await prisma.$transaction(async (tx) => {
    // CAS update on batch
    const batchUpdate = await tx.certificateBatch.updateMany({
      where: {
        id: batchId,
        status: BatchStatus.FAILED,
        currentGenerationKey: expectedCurrentGenerationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATING,
        currentGenerationKey: recoveryKey,
      },
    });

    if (batchUpdate.count !== 1) {
      throw new ConcurrentGenerationConflictError(
        "Batch state changed concurrently during recovery initialization."
      );
    }

    // Reset ONLY the unfinished certificates to PENDING with the new recoveryKey
    for (const cert of unfinishedCerts) {
      await tx.certificate.update({
        where: { id: cert.id },
        data: {
          status: CertificateStatus.PENDING,
          generationKey: recoveryKey,
          generationError: null,
          isStale: cert.generatedFilePath !== null,
        },
      });
    }
  });

  // 7. Enqueue batch orchestrator event with recoveryKey
  await inngest.send({
    name: "autocertif/generation.batch.requested",
    id: `gen-batch-${batchId}-${recoveryKey}`,
    data: {
      batchId,
      generationKey: recoveryKey,
    },
  });

  return {
    reconciled: false,
    generationKey: recoveryKey,
    recoveredCount: unfinishedCerts.length,
  };
}
