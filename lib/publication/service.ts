import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";
import { inngest } from "@/lib/inngest/client";
import { normalizeParticipantName } from "@/lib/participants/normalize";
import { validateRenderingPrerequisites } from "@/lib/generation/preflight";
import { BatchNotFoundError } from "@/lib/batches";
import {
  BatchNotEligibleForPublicationError,
  BatchNotPublishedError,
  ConcurrentPublicationConflictError,
  ZeroEligibleCertificatesError,
  InvalidParticipantNameError,
  PublishedParticipantMismatchError,
} from "./errors";
import type {
  PublishPreflightData,
  PublishBatchResult,
  UnpublishBatchResult,
  PublishedParticipantEditResult,
} from "./types";

/**
 * Fetch publish preflight metrics and verification data for an active batch.
 *
 * Preconditions:
 * - ADMIN authenticated
 * - Batch exists and active (deletedAt == null)
 * - Batch status is GENERATED and publishedAt is null
 * - Batch has a template configured
 */
export async function getPublishPreflight(
  batchId: string
): Promise<PublishPreflightData> {
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
      publishedAt: true,
      currentGenerationKey: true,
      templateId: true,
    },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.status !== BatchStatus.GENERATED || batch.publishedAt !== null) {
    throw new BatchNotEligibleForPublicationError(
      `Batch is in "${batch.status}" status (publishedAt: ${batch.publishedAt ? "set" : "null"}). Preflight requires GENERATED and unpublished batch.`
    );
  }

  if (!batch.templateId) {
    throw new BatchNotEligibleForPublicationError(
      "Batch must have a configured template before publishing."
    );
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

  let eligibleCount = 0;
  let failedCount = 0;
  const failedParticipantNames: string[] = [];

  for (const p of participants) {
    const cert = p.certificate;
    // Guardrail #5: Eligibility strictly requires status == GENERATED, generatedFilePath != null, generatedAt != null, isStale == false
    // Does NOT require cert.generationKey == batch.currentGenerationKey
    const isEligible =
      cert !== null &&
      cert.status === CertificateStatus.GENERATED &&
      cert.generatedFilePath !== null &&
      cert.generatedAt !== null &&
      cert.isStale === false;

    if (isEligible) {
      eligibleCount++;
    } else {
      failedCount++;
      failedParticipantNames.push(p.name);
    }
  }

  return {
    batchId: batch.id,
    batchName: batch.name,
    totalParticipants: participants.length,
    eligibleCount,
    failedCount,
    failedParticipantNames,
    canPublish: eligibleCount > 0,
    currentGenerationKey: batch.currentGenerationKey,
  };
}

/**
 * Atomically publish a certificate batch.
 *
 * Implements Guardrail #2:
 * - Evaluates CURRENT certificate eligibility inside the transaction
 * - Establishes fresh publication snapshots for eligible certificates
 * - Clears publication snapshots for ineligible certificates (republish hygiene)
 * - Transitions batch status to PUBLISHED and sets publishedAt = now
 * - Uses CAS concurrency guard matching expectedCurrentGenerationKey
 */
export async function publishBatch(
  batchId: string,
  expectedCurrentGenerationKey: string | null
): Promise<PublishBatchResult> {
  await requireAdmin();

  return await prisma.$transaction(async (tx) => {
    // 1. Re-validate batch state with optimistic concurrency check
    const batch = await tx.certificateBatch.findFirst({
      where: {
        id: batchId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        currentGenerationKey: true,
        templateId: true,
      },
    });

    if (!batch) {
      throw new BatchNotFoundError();
    }

    if (
      batch.status !== BatchStatus.GENERATED ||
      batch.publishedAt !== null ||
      batch.currentGenerationKey !== expectedCurrentGenerationKey
    ) {
      throw new ConcurrentPublicationConflictError(
        "Batch state changed or generation key is stale. Please refresh and try again."
      );
    }

    if (!batch.templateId) {
      throw new BatchNotEligibleForPublicationError(
        "Batch cannot be published without a configured template."
      );
    }

    // 2. Query all active participants and their certificates
    const participants = await tx.participant.findMany({
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
    });

    // 3. Separate into currently eligible and currently ineligible certificates
    const eligibleCertificates: Array<{ id: string; name: string; filePath: string }> = [];
    const ineligibleCertificateIds: string[] = [];

    for (const p of participants) {
      const cert = p.certificate;
      if (
        cert &&
        cert.status === CertificateStatus.GENERATED &&
        cert.generatedFilePath !== null &&
        cert.generatedAt !== null &&
        cert.isStale === false
      ) {
        eligibleCertificates.push({
          id: cert.id,
          name: p.name,
          filePath: cert.generatedFilePath,
        });
      } else if (cert) {
        ineligibleCertificateIds.push(cert.id);
      }
    }

    if (eligibleCertificates.length === 0) {
      throw new ZeroEligibleCertificatesError();
    }

    // 4. Update eligible certificates with fresh publication snapshot
    for (const item of eligibleCertificates) {
      await tx.certificate.update({
        where: { id: item.id },
        data: {
          publishedName: item.name,
          publishedFilePath: item.filePath,
        },
      });
    }

    // 5. Clear publication snapshots for ineligible certificates (Guardrail #2 republish hygiene)
    if (ineligibleCertificateIds.length > 0) {
      await tx.certificate.updateMany({
        where: {
          id: { in: ineligibleCertificateIds },
        },
        data: {
          publishedName: null,
          publishedFilePath: null,
        },
      });
    }

    // 6. Transition batch to PUBLISHED and record publishedAt
    const now = new Date();
    const batchUpdate = await tx.certificateBatch.updateMany({
      where: {
        id: batchId,
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: expectedCurrentGenerationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.PUBLISHED,
        publishedAt: now,
      },
    });

    if (batchUpdate.count !== 1) {
      throw new ConcurrentPublicationConflictError(
        "Concurrent conflict while finalizing batch publication."
      );
    }

    return {
      batchId,
      publishedAt: now.toISOString(),
      publishedCount: eligibleCertificates.length,
      ineligibleCount: participants.length - eligibleCertificates.length,
    };
  });
}

/**
 * Unpublish a batch immediately.
 *
 * Contract:
 * - Authoritative kill switch: publishedAt becomes null immediately
 * - If status is PUBLISHED -> transitions to GENERATED
 * - If status is GENERATING or FAILED -> operational status remains intact
 * - Zero storage files deleted
 * - Zero database records deleted
 */
export async function unpublishBatch(
  batchId: string
): Promise<UnpublishBatchResult> {
  await requireAdmin();

  return await prisma.$transaction(async (tx) => {
    const batch = await tx.certificateBatch.findFirst({
      where: {
        id: batchId,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        publishedAt: true,
      },
    });

    if (!batch) {
      throw new BatchNotFoundError();
    }

    if (batch.publishedAt === null) {
      // Already unpublished: idempotent success
      return { batchId, unpublished: true };
    }

    // Transition PUBLISHED -> GENERATED, or preserve GENERATING/FAILED
    const nextStatus =
      batch.status === BatchStatus.PUBLISHED
        ? BatchStatus.GENERATED
        : batch.status;

    await tx.certificateBatch.update({
      where: { id: batchId },
      data: {
        publishedAt: null,
        status: nextStatus,
      },
    });

    return {
      batchId,
      unpublished: true,
    };
  });
}

/**
 * Edit a participant's name on a PUBLISHED batch.
 *
 * Implements Guardrail #4:
 * - Narrow, dedicated mutation (Phase 6 DRAFT CRUD guards remain intact)
 * - Validates batch is PUBLISHED and idle
 * - Normalizes name; rejects empty or identical names
 * - Preflight validates rendering prerequisites for target participant
 * - Atomic initialization:
 *   - Participant.name = NEW
 *   - Certificate.publishedName = OLD (preserved)
 *   - Certificate.publishedFilePath = OLD_FILE (preserved)
 *   - Certificate.status = PENDING, isStale = true, generationKey = freshKey
 *   - batch.status = GENERATING, currentGenerationKey = freshKey, publishedAt = UNCHANGED
 * - Dispatches Inngest event
 */
export async function editPublishedParticipantName(
  batchId: string,
  participantId: string,
  rawNewName: unknown,
  expectedCurrentGenerationKey: string | null
): Promise<PublishedParticipantEditResult> {
  await requireAdmin();

  const newName = normalizeParticipantName(rawNewName);
  if (!newName) {
    throw new InvalidParticipantNameError(
      "Participant name is required and must not be empty after normalization."
    );
  }

  // 1. Batch preconditions
  const batch = await prisma.certificateBatch.findFirst({
    where: {
      id: batchId,
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      publishedAt: true,
      currentGenerationKey: true,
    },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.publishedAt === null) {
    throw new BatchNotPublishedError();
  }

  if (batch.status !== BatchStatus.PUBLISHED) {
    throw new BatchNotEligibleForPublicationError(
      `Batch is currently in "${batch.status}" status. Participant name edit is only allowed when batch is PUBLISHED and idle.`
    );
  }

  if (batch.currentGenerationKey !== expectedCurrentGenerationKey) {
    throw new ConcurrentPublicationConflictError(
      "Generation identity is stale or batch state changed. Please refresh and try again."
    );
  }

  // 2. Participant & Certificate preconditions
  const participant = await prisma.participant.findFirst({
    where: {
      id: participantId,
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
  });

  if (!participant || !participant.certificate) {
    throw new PublishedParticipantMismatchError();
  }

  if (participant.name === newName) {
    throw new InvalidParticipantNameError(
      "New participant name must differ from the existing name."
    );
  }

  // 3. Shared rendering prerequisites
  await validateRenderingPrerequisites(batchId, [participantId]);

  // 4. Generate fresh generationKey
  const newGenerationKey = crypto.randomUUID();
  const certId = participant.certificate.id;
  const previousPublishedName = participant.certificate.publishedName;

  // 5. Atomic initialization transaction
  await prisma.$transaction(async (tx) => {
    // CAS on batch: PUBLISHED -> GENERATING, keeps publishedAt
    const batchUpdate = await tx.certificateBatch.updateMany({
      where: {
        id: batchId,
        status: BatchStatus.PUBLISHED,
        currentGenerationKey: expectedCurrentGenerationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATING,
        currentGenerationKey: newGenerationKey,
      },
    });

    if (batchUpdate.count !== 1) {
      throw new ConcurrentPublicationConflictError(
        "Batch state changed concurrently during replacement initialization."
      );
    }

    // Update participant name to NEW
    await tx.participant.update({
      where: { id: participantId },
      data: { name: newName },
    });

    // Update target Certificate: PENDING, fresh generationKey, isStale = true
    // Preserves publishedName, publishedFilePath, generatedFilePath, generatedAt
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

  // 6. Enqueue Inngest batch orchestrator event
  await inngest.send({
    name: "autocertif/generation.batch.requested",
    id: `gen-batch-${batchId}-${newGenerationKey}`,
    data: {
      batchId,
      generationKey: newGenerationKey,
    },
  });

  return {
    batchId,
    participantId,
    generationKey: newGenerationKey,
    newName,
    previousPublishedName,
  };
}

/**
 * Retry generation for a FAILED replacement on a PUBLISHED batch.
 *
 * Preconditions:
 * - Batch is PUBLISHED and publishedAt != null
 * - Target Certificate is FAILED with isStale == true
 * - CAS matches expectedCurrentGenerationKey
 */
export async function retryPublishedReplacement(
  batchId: string,
  participantId: string,
  expectedCurrentGenerationKey: string | null
): Promise<{ generationKey: string; participantId: string }> {
  await requireAdmin();

  // 1. Batch preconditions
  const batch = await prisma.certificateBatch.findFirst({
    where: {
      id: batchId,
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      publishedAt: true,
      currentGenerationKey: true,
    },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.publishedAt === null) {
    throw new BatchNotPublishedError();
  }

  if (batch.status !== BatchStatus.PUBLISHED) {
    throw new BatchNotEligibleForPublicationError(
      `Batch is currently in "${batch.status}" status. Retry replacement is only allowed when batch is PUBLISHED and idle.`
    );
  }

  if (batch.currentGenerationKey !== expectedCurrentGenerationKey) {
    throw new ConcurrentPublicationConflictError(
      "Generation identity is stale or batch state changed. Please refresh and try again."
    );
  }

  // 2. Participant & Certificate preconditions
  const participant = await prisma.participant.findFirst({
    where: {
      id: participantId,
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
  });

  if (!participant || !participant.certificate) {
    throw new PublishedParticipantMismatchError();
  }

  if (participant.certificate.status !== CertificateStatus.FAILED) {
    throw new BatchNotEligibleForPublicationError(
      `Certificate is in "${participant.certificate.status}" status. Retry is only permitted for FAILED certificates.`
    );
  }

  // 3. Shared rendering prerequisites
  await validateRenderingPrerequisites(batchId, [participantId]);

  // 4. Generate fresh generationKey
  const newGenerationKey = crypto.randomUUID();
  const certId = participant.certificate.id;

  // 5. Atomic transaction: batch -> GENERATING, cert -> PENDING
  await prisma.$transaction(async (tx) => {
    const batchUpdate = await tx.certificateBatch.updateMany({
      where: {
        id: batchId,
        status: BatchStatus.PUBLISHED,
        currentGenerationKey: expectedCurrentGenerationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATING,
        currentGenerationKey: newGenerationKey,
      },
    });

    if (batchUpdate.count !== 1) {
      throw new ConcurrentPublicationConflictError(
        "Batch state changed concurrently during retry initialization."
      );
    }

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

  // 6. Enqueue Inngest event
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
    participantId,
  };
}
