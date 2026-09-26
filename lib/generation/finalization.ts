import { prisma } from "@/lib/prisma";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";

export interface FinalizationResult {
  finalized: boolean;
  reason:
    | "already_finalized"
    | "still_pending"
    | "finalized"
    | "stale_attempt"
    | "batch_not_found";
  pendingCount?: number;
}

/**
 * Reusable, race-safe, idempotent terminal batch finalization helper.
 *
 * Verifies that the batch is still in GENERATING status with the specified generationKey,
 * counts active certificates for this generation attempt that are still in PENDING or GENERATING.
 * If zero remain, conditionally transitions the batch status from GENERATING to GENERATED.
 *
 * Used by:
 * - Participant worker upon successful certificate generation
 * - Participant worker upon deterministic domain failure
 * - Participant worker onFailure upon retry exhaustion
 * - Batch orchestrator when no pending fan-out work exists
 */
export async function checkAndFinalizeBatch(
  batchId: string,
  generationKey: string
): Promise<FinalizationResult> {
  // 1. Verify current batch state
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
    return { finalized: false, reason: "batch_not_found" };
  }

  // Stale event guard: if batch currentGenerationKey does not match, ignore
  if (batch.currentGenerationKey !== generationKey) {
    return { finalized: false, reason: "stale_attempt" };
  }

  // If already reached terminal state
  if (batch.status !== BatchStatus.GENERATING) {
    return { finalized: false, reason: "already_finalized" };
  }

  // 2. Count active certificates for this generation attempt still in progress
  const activeUnfinishedCount = await prisma.certificate.count({
    where: {
      batchId,
      generationKey,
      deletedAt: null,
      status: {
        in: [CertificateStatus.PENDING, CertificateStatus.GENERATING],
      },
    },
  });

  if (activeUnfinishedCount > 0) {
    return {
      finalized: false,
      reason: "still_pending",
      pendingCount: activeUnfinishedCount,
    };
  }

  // 3. Atomically transition batch to GENERATED using dual conditional check
  const updateResult = await prisma.certificateBatch.updateMany({
    where: {
      id: batchId,
      status: BatchStatus.GENERATING,
      currentGenerationKey: generationKey,
      deletedAt: null,
    },
    data: {
      status: BatchStatus.GENERATED,
    },
  });

  return {
    finalized: updateResult.count === 1,
    reason: updateResult.count === 1 ? "finalized" : "already_finalized",
    pendingCount: 0,
  };
}
