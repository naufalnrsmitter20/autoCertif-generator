import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";
import { checkAndFinalizeBatch } from "@/lib/generation/finalization";
import type { BatchRequestedPayload } from "../events";

/**
 * Batch Orchestrator Function
 *
 * Triggered by "autocertif/generation.batch.requested".
 * 1. Validates batch status is GENERATING with matching currentGenerationKey.
 * 2. Fetches all PENDING certificates for the current generation attempt.
 * 3. Fans out one durable "autocertif/generation.participant.requested" event
 *    per participant using stable, deterministic event IDs.
 * 4. If all retries are exhausted, transitions batch to FAILED via onFailure.
 */
export const generateBatch = inngest.createFunction(
  {
    id: "autocertif-generate-batch",
    triggers: [{ event: "autocertif/generation.batch.requested" }],
    retries: 3,
    onFailure: async ({ event, step }) => {
      // event.data.event is the original event that exhausted its retries
      const originalPayload = (event.data?.event?.data ?? {}) as Partial<BatchRequestedPayload>;
      const batchId = originalPayload.batchId;
      const generationKey = originalPayload.generationKey;

      if (!batchId || !generationKey) {
        return;
      }

      await step.run("mark-batch-failed-on-retry-exhaustion", async () => {
        await prisma.certificateBatch.updateMany({
          where: {
            id: batchId,
            status: BatchStatus.GENERATING,
            currentGenerationKey: generationKey,
            deletedAt: null,
          },
          data: {
            status: BatchStatus.FAILED,
          },
        });
      });
    },
  },
  async ({ event, step }) => {
    const { batchId, generationKey } = event.data as BatchRequestedPayload;

    // Step 1: Validate batch state and load active pending certificates
    const validation = await step.run(
      "validate-batch-and-load-certificates",
      async (): Promise<
        | { shouldProceed: false; reason: string }
        | {
            shouldProceed: true;
            certificates: Array<{ id: string; participantId: string }>;
          }
      > => {
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
          return { shouldProceed: false, reason: "Batch not found" };
        }

        // Stale attempt guard: reject if currentGenerationKey doesn't match
        if (batch.currentGenerationKey !== generationKey) {
          return {
            shouldProceed: false,
            reason: `Stale generation event: batch key "${batch.currentGenerationKey}" !== event key "${generationKey}"`,
          };
        }

        if (batch.status !== BatchStatus.GENERATING) {
          return {
            shouldProceed: false,
            reason: `Batch is in status "${batch.status}", expected GENERATING`,
          };
        }

        // Load active PENDING certificates belonging to this generation attempt
        const pendingCerts = await prisma.certificate.findMany({
          where: {
            batchId,
            generationKey,
            deletedAt: null,
            status: CertificateStatus.PENDING,
          },
          select: {
            id: true,
            participantId: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        });

        return {
          shouldProceed: true,
          certificates: pendingCerts,
        };
      }
    );

    if (!validation.shouldProceed) {
      return { skipped: true, reason: validation.reason };
    }

    // If zero certificates remain pending, run finalization check directly
    if (validation.certificates.length === 0) {
      await step.run("reconcile-empty-batch-finalization", async () => {
        await checkAndFinalizeBatch(batchId, generationKey);
      });
      return { fanOutCount: 0, finalized: true };
    }

    // Step 2: Durable fan-out with deterministic event IDs
    const participantEvents = validation.certificates.map(
      (cert: { id: string; participantId: string }) => ({
        name: "autocertif/generation.participant.requested" as const,
        id: `gen-part-${cert.id}-${generationKey}`,
        data: {
          batchId,
          participantId: cert.participantId,
          certificateId: cert.id,
          generationKey,
        },
      })
    );

    await step.sendEvent("fan-out-participant-events", participantEvents);

    return {
      fanOutCount: participantEvents.length,
      generationKey,
    };
  }
);
