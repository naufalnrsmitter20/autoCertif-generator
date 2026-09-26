import { prisma } from "@/lib/prisma";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";
import { executeGenerationPreflight } from "./preflight";
import { ConcurrentGenerationConflictError } from "./errors";

export interface InitializationResult {
  generationKey: string;
  participantCount: number;
}

/**
 * Atomically initializes bulk generation:
 * 1. Executes preflight validation outside the transaction.
 * 2. Generates a unique generationKey (UUID v4).
 * 3. Inside an atomic Prisma transaction:
 *    - Revalidates that the batch is still DRAFT and references the expected template.
 *    - Revalidates that the template updatedAt timestamp has not changed.
 *    - Revalidates that the active participants set matches the preflight snapshot.
 *    - Upserts one PENDING Certificate row per active participant with generationKey.
 *    - Transitions batch from DRAFT to GENERATING and sets currentGenerationKey.
 */
export async function initializeGeneration(
  batchId: string
): Promise<InitializationResult> {
  // 1. Run comprehensive preflight
  const snapshot = await executeGenerationPreflight(batchId);

  // 2. Generate new unique generationKey
  const generationKey = crypto.randomUUID();

  // 3. Atomically validate snapshot and commit initialization
  return await prisma.$transaction(
    async (tx) => {
      // Re-verify batch state inside transaction
      const txBatch = await tx.certificateBatch.findFirst({
        where: {
          id: batchId,
          deletedAt: null,
        },
        select: {
          id: true,
          status: true,
          templateId: true,
        },
      });

      if (!txBatch) {
        throw new ConcurrentGenerationConflictError("Batch was deleted during initialization.");
      }

      if (txBatch.status !== BatchStatus.DRAFT) {
        throw new ConcurrentGenerationConflictError(
          `Batch status changed concurrently to "${txBatch.status}". Generation aborted.`
        );
      }

      if (txBatch.templateId !== snapshot.templateId) {
        throw new ConcurrentGenerationConflictError(
          "Template assignment changed concurrently during preflight. Generation aborted."
        );
      }

      // Re-verify template snapshot inside transaction
      const txTemplate = await tx.certificateTemplate.findFirst({
        where: {
          id: snapshot.templateId,
          deletedAt: null,
        },
        select: {
          id: true,
          updatedAt: true,
        },
      });

      if (!txTemplate) {
        throw new ConcurrentGenerationConflictError("Template was deleted during initialization.");
      }

      if (txTemplate.updatedAt.getTime() !== snapshot.templateUpdatedAt.getTime()) {
        throw new ConcurrentGenerationConflictError(
          "Template configuration was modified concurrently during preflight. Generation aborted."
        );
      }

      // Re-verify active participants inside transaction
      const txParticipants = await tx.participant.findMany({
        where: {
          batchId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (txParticipants.length !== snapshot.activeParticipants.length) {
        throw new ConcurrentGenerationConflictError(
          "Participant list was modified concurrently during preflight. Generation aborted."
        );
      }

      const snapshotIdSet = new Set(snapshot.activeParticipants.map((p) => p.id));
      const allMatch = txParticipants.every((p) => snapshotIdSet.has(p.id));
      if (!allMatch) {
        throw new ConcurrentGenerationConflictError(
          "Participant identities changed concurrently during preflight. Generation aborted."
        );
      }

      // Prepare PENDING Certificate rows for this generation attempt
      for (const participant of snapshot.activeParticipants) {
        await tx.certificate.upsert({
          where: { participantId: participant.id },
          create: {
            participantId: participant.id,
            batchId,
            status: CertificateStatus.PENDING,
            generationKey,
            isStale: false,
            generationError: null,
            generatedFilePath: null,
            previewFilePath: null,
            generatedAt: null,
          },
          update: {
            batchId,
            status: CertificateStatus.PENDING,
            generationKey,
            isStale: false,
            generationError: null,
            generatedFilePath: null,
            previewFilePath: null,
            generatedAt: null,
          },
        });
      }

      // Atomically transition batch to GENERATING with currentGenerationKey
      const batchUpdateResult = await tx.certificateBatch.updateMany({
        where: {
          id: batchId,
          status: BatchStatus.DRAFT,
          deletedAt: null,
        },
        data: {
          status: BatchStatus.GENERATING,
          currentGenerationKey: generationKey,
        },
      });

      if (batchUpdateResult.count !== 1) {
        throw new ConcurrentGenerationConflictError(
          "Concurrent update prevented batch status transition to GENERATING."
        );
      }

      return {
        generationKey,
        participantCount: snapshot.activeParticipants.length,
      };
    },
    { maxWait: 10000, timeout: 20000 }
  );
}

/**
 * Checks whether an active batch is in a recoverable dispatch state:
 * - status === GENERATING
 * - currentGenerationKey is present
 * - all active certificates with that generationKey remain PENDING (none started yet)
 */
export async function getRecoverableDispatchKey(
  batchId: string
): Promise<{ canResume: boolean; generationKey?: string; reason?: string }> {
  const batch = await prisma.certificateBatch.findFirst({
    where: {
      id: batchId,
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      currentGenerationKey: true,
    },
  });

  if (!batch) {
    return { canResume: false, reason: "Batch not found." };
  }

  if (batch.status !== BatchStatus.GENERATING) {
    return {
      canResume: false,
      reason: `Batch is in "${batch.status}" status, not GENERATING.`,
    };
  }

  if (!batch.currentGenerationKey) {
    return { canResume: false, reason: "No current generation key recorded." };
  }

  // Count certificates for this attempt
  const certificates = await prisma.certificate.findMany({
    where: {
      batchId,
      generationKey: batch.currentGenerationKey,
      deletedAt: null,
    },
    select: {
      status: true,
    },
  });

  if (certificates.length === 0) {
    return { canResume: false, reason: "No certificates found for this generation attempt." };
  }

  const allPending = certificates.every(
    (c) => c.status === CertificateStatus.PENDING
  );

  if (!allPending) {
    return {
      canResume: false,
      reason: "Generation is actively in progress or has completed participants.",
    };
  }

  return {
    canResume: true,
    generationKey: batch.currentGenerationKey,
  };
}
