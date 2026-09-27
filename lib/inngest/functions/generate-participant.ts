import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";
import { namePlacementSchema } from "@/lib/coordinates";
import { parseFontConfig } from "@/lib/rendering/font-config";
import { resolveFontBytes } from "@/lib/rendering/font-registry";
import { renderSingleCertificate } from "@/lib/rendering/engine";
import { downloadTemplateBuffer, uploadGeneratedCertificate } from "@/lib/storage/server";
import {
  isParticipantDomainError,
  toSafeGenerationErrorMessage,
} from "@/lib/generation/errors";
import { checkAndFinalizeBatch } from "@/lib/generation/finalization";
import type { ParticipantRequestedPayload } from "../events";

/**
 * Participant Worker Function
 *
 * Triggered by "autocertif/generation.participant.requested".
 * Concurrency bounded to 5 active step executions across the environment.
 * Automatic retry bounded to 3 retries (4 total attempts) for transient failures.
 *
 * Lifecycle:
 * 1. Claims certificate: PENDING -> GENERATING (conditional atomic update).
 * 2. Renders single certificate in-memory & uploads to private Supabase Storage.
 * 3. On participant domain failure (e.g. NameDoesNotFitError):
 *    - Transitions Certificate to FAILED with structured error code.
 *    - Explicitly skips success finalize step.
 *    - Calls shared batch finalization helper.
 * 4. On transient failure:
 *    - Throws error out of step to allow Inngest retries.
 * 5. On retry exhaustion (onFailure):
 *    - If certificate is still GENERATING, marks it FAILED (INFRASTRUCTURE_FAILURE).
 *    - Invokes batch finalization helper to prevent batch getting stuck in GENERATING.
 */
export const generateParticipant = inngest.createFunction(
  {
    id: "autocertif-generate-participant",
    triggers: [{ event: "autocertif/generation.participant.requested" }],
    retries: 3,
    concurrency: {
      limit: 5,
      scope: "fn",
    },
    onFailure: async ({ event, step }) => {
      const originalPayload = (event.data?.event?.data ?? {}) as Partial<ParticipantRequestedPayload>;
      const { batchId, certificateId, generationKey } = originalPayload;

      if (!batchId || !certificateId || !generationKey) {
        return;
      }

      await step.run("reconcile-participant-failure-on-retry-exhaustion", async () => {
        // Only mark FAILED if still in GENERATING status for this exact generationKey
        await prisma.certificate.updateMany({
          where: {
            id: certificateId,
            batchId,
            generationKey,
            status: CertificateStatus.GENERATING,
            deletedAt: null,
          },
          data: {
            status: CertificateStatus.FAILED,
            generationError: "INFRASTRUCTURE_FAILURE: Retry limit exceeded for transient failure",
          },
        });

        // Trigger race-safe batch finalization check
        await checkAndFinalizeBatch(batchId, generationKey);
      });
    },
  },
  async ({ event, step }) => {
    const { batchId, participantId, certificateId, generationKey } = event.data as ParticipantRequestedPayload;

    // Step 1: Claim participant certificate (PENDING -> GENERATING)
    const claim = await step.run(
      "claim-participant-certificate",
      async (): Promise<{ shouldProceed: boolean; reason?: string }> => {
        // 1. Validate batch state
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
        return { shouldProceed: false, reason: "batch_not_found" };
      }

      if (batch.currentGenerationKey !== generationKey) {
        return { shouldProceed: false, reason: "stale_generation_key" };
      }

      if (batch.status !== BatchStatus.GENERATING) {
        return { shouldProceed: false, reason: "batch_not_generating" };
      }

      // 2. Validate participant is active
      const participant = await prisma.participant.findFirst({
        where: {
          id: participantId,
          batchId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!participant) {
        return { shouldProceed: false, reason: "participant_not_found_or_deleted" };
      }

      // 3. Atomically transition Certificate from PENDING to GENERATING
      const updateResult = await prisma.certificate.updateMany({
        where: {
          id: certificateId,
          batchId,
          generationKey,
          status: CertificateStatus.PENDING,
          deletedAt: null,
        },
        data: {
          status: CertificateStatus.GENERATING,
        },
      });

      if (updateResult.count !== 1) {
        // Certificate was already claimed or already reached terminal state (e.g. on replay)
        return { shouldProceed: false, reason: "already_claimed_or_terminal" };
      }

      return { shouldProceed: true };
    });

    if (!claim.shouldProceed) {
      return { skipped: true, reason: claim.reason };
    }

    // Step 2: Render single certificate in-memory & upload to private storage
    // Bounded step execution keeps large byte arrays out of Inngest step output serialization
    const renderResult = await step.run("render-and-upload-certificate", async () => {
      // Fetch required generation context
      const batch = await prisma.certificateBatch.findFirst({
        where: {
          id: batchId,
          deletedAt: null,
        },
        include: {
          template: true,
        },
      });

      const participant = await prisma.participant.findFirst({
        where: {
          id: participantId,
          batchId,
          deletedAt: null,
        },
      });

      if (!batch?.template || !participant) {
        throw new Error("Batch template or participant not found during render step.");
      }

      const template = batch.template;
      if (!template.sourceFilePath || !template.namePlacement || !template.fontConfig) {
        throw new Error("Missing template configuration during render step.");
      }

      const placement = namePlacementSchema.parse(template.namePlacement);
      const style = parseFontConfig(template.fontConfig);
      const fontBytes = await resolveFontBytes(template.fontAssetPath);
      const templateBuffer = await downloadTemplateBuffer(template.sourceFilePath);

      const storagePath = `certificates/${batchId}/${participantId}/${generationKey}.pdf`;

      try {
        const result = await renderSingleCertificate({
          template: {
            fileType: template.fileType,
            sourceBytes: templateBuffer,
            pageWidth: template.pageWidth,
            pageHeight: template.pageHeight,
          },
          placement,
          participant: {
            name: participant.name,
          },
          font: {
            fontBytes,
            fontFamily: template.fontFamily ?? undefined,
          },
          style,
        });

        // Upload generated PDF directly to private Supabase Storage
        await uploadGeneratedCertificate(storagePath, result.pdfBytes);

        return {
          outcome: "success" as const,
          storagePath,
          generatedAt: new Date().toISOString(),
          fontSize: result.fontSize,
          layoutMode: result.layoutPlan.mode,
        };
      } catch (renderError) {
        // Participant-specific deterministic domain failure
        if (isParticipantDomainError(renderError)) {
          const safeError = toSafeGenerationErrorMessage(renderError);

          // Atomically update Certificate to FAILED
          await prisma.certificate.updateMany({
            where: {
              id: certificateId,
              batchId,
              generationKey,
              status: CertificateStatus.GENERATING,
              deletedAt: null,
            },
            data: {
              status: CertificateStatus.FAILED,
              generationError: safeError,
            },
          });

          return {
            outcome: "domain_failure" as const,
            error: safeError,
          };
        }

        // Transient / infrastructure failure -> re-throw to allow Inngest retry
        throw renderError;
      }
    });

    // Step 3: Finalize certificate on success ONLY (Correction #7: explicit branching)
    if (renderResult.outcome === "success") {
      await step.run("finalize-certificate-record", async () => {
        // Publication-aware cutover guard (Guardrail #3)
        const batch = await prisma.certificateBatch.findFirst({
          where: { id: batchId, deletedAt: null },
          select: { publishedAt: true },
        });

        const isPublished = batch?.publishedAt !== null;

        let currentParticipantName: string | null = null;
        if (isPublished) {
          const participant = await prisma.participant.findFirst({
            where: { id: participantId, batchId, deletedAt: null },
            select: { name: true },
          });
          currentParticipantName = participant?.name ?? null;
        }

        await prisma.certificate.updateMany({
          where: {
            id: certificateId,
            batchId,
            generationKey,
            status: CertificateStatus.GENERATING,
            deletedAt: null,
          },
          data: {
            status: CertificateStatus.GENERATED,
            generatedFilePath: renderResult.storagePath,
            generatedAt: new Date(renderResult.generatedAt),
            generationError: null,
            isStale: false,
            ...(isPublished && currentParticipantName !== null
              ? {
                  publishedFilePath: renderResult.storagePath,
                  publishedName: currentParticipantName,
                }
              : {}),
          },
        });
      });
    }

    // Step 4: Race-safe terminal batch finalization check
    // Always runs after participant reaches terminal state (GENERATED or FAILED)
    const finalization = await step.run("check-batch-finalization", async () => {
      return await checkAndFinalizeBatch(batchId, generationKey);
    });

    return {
      certificateId,
      outcome: renderResult.outcome,
      finalization,
    };
  }
);
