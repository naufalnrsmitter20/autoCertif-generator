import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com", role: "ADMIN" }),
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({ ids: ["test-event-id"] }),
  },
}));

import { prisma } from "@/lib/prisma";
import {
  registerTestFont,
  clearTestFontRegistry,
  PRODUCTION_FONT_REGISTRY,
} from "@/lib/rendering/font-registry";
import { initializeGeneration } from "@/lib/generation/initialize";
import { checkAndFinalizeBatch } from "@/lib/generation/finalization";
import { renderSingleCertificate } from "@/lib/rendering/engine";
import {
  uploadGeneratedCertificate,
  getServerStorageClient,
  downloadTemplateBuffer,
} from "@/lib/storage/server";
import {
  GENERATED_CERTIFICATES_BUCKET,
  TEMPLATE_STORAGE_BUCKET,
} from "@/lib/storage/constants";
import { PDFDocument } from "pdf-lib";
import {
  BatchStatus,
  CertificateStatus,
  TemplateFileType,
} from "@/generated/prisma/client";
import {
  isParticipantDomainError,
  toSafeGenerationErrorMessage,
} from "@/lib/generation/errors";
import { namePlacementSchema } from "@/lib/coordinates";
import { parseFontConfig } from "@/lib/rendering/font-config";
import { resolveFontBytes } from "@/lib/rendering/font-registry";
import {
  getBatchGenerationManagementData,
  regenerateParticipantGeneration,
  recoverFailedBatchGeneration,
} from "@/lib/generation/management";

describe("Phase 10 Live Architecture & Supabase Output Integration", { timeout: 60000 }, () => {
  const timestamp = Date.now();
  const testTemplateId = `tpl-live-p10-${timestamp}`;
  const testBatchId = `batch-live-p10-${timestamp}`;
  const templateStoragePath = `templates/${testBatchId}/source.pdf`;

  let participantAId: string;
  let participantBId: string;
  let certificateAId: string;
  let certificateBId: string;
  let firstGenKey: string;
  let firstGenCertAPath: string;
  let secondGenCertAPath: string;

  async function withRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err: unknown) {
        if (i === retries - 1) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("EAI_AGAIN") ||
          msg.includes("timeout") ||
          msg.includes("ECONNRESET") ||
          msg.includes("fetch failed") ||
          msg.includes("Can't reach database server")
        ) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Retry exhausted");
  }

  beforeAll(async () => {
    expect(Object.keys(PRODUCTION_FONT_REGISTRY)).toHaveLength(0);
    registerTestFont("test-font", "tests/fixtures/fonts/test-font.ttf");

    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([842, 595]);
    const pdfBytes = await pdfDoc.save();

    const supabase = getServerStorageClient();
    await withRetry(async () => {
      const { error: uploadError } = await supabase.storage
        .from(TEMPLATE_STORAGE_BUCKET)
        .upload(templateStoragePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Failed to upload test template to storage: ${uploadError.message}`);
      }
    });

    await withRetry(() =>
      prisma.certificateTemplate.create({
        data: {
          id: testTemplateId,
        name: `Phase 10 Test Template ${timestamp}`,
        fileType: TemplateFileType.PDF,
        sourceFilePath: templateStoragePath,
        pageWidth: 842,
        pageHeight: 595,
        namePlacement: {
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.35,
          alignment: "center",
        },
        fontAssetPath: "test-font",
        fontConfig: {
          fontSize: 28,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0.1, g: 0.1, b: 0.1 },
          stepSize: 1,
        },
      },
    })
  );

    await withRetry(() =>
      prisma.certificateBatch.create({
        data: {
          id: testBatchId,
          name: `Phase 10 Test Batch ${timestamp}`,
          status: BatchStatus.DRAFT,
          templateId: testTemplateId,
        },
      })
    );

    const partA = await withRetry(() =>
      prisma.participant.create({
        data: {
          batchId: testBatchId,
          name: "Ahmad Budi Santoso",
        },
      })
    );
    participantAId = partA.id;

    const partB = await withRetry(() =>
      prisma.participant.create({
        data: {
          batchId: testBatchId,
          name: "Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Senior Third Count of Lichtenstein von Hohenzollern the Great Emperor",
        },
      })
    );
    participantBId = partB.id;
  });

  afterAll(async () => {
    clearTestFontRegistry();

    const supabase = getServerStorageClient();
    const certPathsToClean = [firstGenCertAPath, secondGenCertAPath].filter(Boolean);
    if (certPathsToClean.length > 0) {
      await supabase.storage
        .from(GENERATED_CERTIFICATES_BUCKET)
        .remove(certPathsToClean);
    }
    await supabase.storage
      .from(TEMPLATE_STORAGE_BUCKET)
      .remove([templateStoragePath]);

    await prisma.certificate.deleteMany({ where: { batchId: testBatchId } }).catch(() => {});
    await prisma.participant.deleteMany({ where: { batchId: testBatchId } }).catch(() => {});
    await prisma.certificateBatch.deleteMany({ where: { id: testBatchId } }).catch(() => {});
    await prisma.certificateTemplate.deleteMany({ where: { id: testTemplateId } }).catch(() => {});
  });

  it("Step 1: Initial bulk generation sets 1 GENERATED, 1 FAILED, batch returns GENERATED", async () => {
    const initResult = await initializeGeneration(testBatchId);
    firstGenKey = initResult.generationKey;

    const certA = await prisma.certificate.findUnique({
      where: { participantId_batchId: { participantId: participantAId, batchId: testBatchId } },
    });
    const certB = await prisma.certificate.findUnique({
      where: { participantId_batchId: { participantId: participantBId, batchId: testBatchId } },
    });
    certificateAId = certA!.id;
    certificateBId = certB!.id;

    // Simulate worker for Participant A (renders successfully)
    firstGenCertAPath = `certificates/${testBatchId}/${participantAId}/${firstGenKey}.pdf`;
    const tplBuffer = await downloadTemplateBuffer(templateStoragePath);
    const fontBytes = await resolveFontBytes("test-font");

    const renderA = await renderSingleCertificate({
      template: { fileType: TemplateFileType.PDF, sourceBytes: tplBuffer, pageWidth: 842, pageHeight: 595 },
      placement: namePlacementSchema.parse({ xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.35, alignment: "center" }),
      participant: { name: "Ahmad Budi Santoso" },
      font: { fontBytes },
      style: parseFontConfig({ fontSize: 28, minFontSize: 16, lineHeightMultiplier: 1.2, textColor: { r: 0.1, g: 0.1, b: 0.1 } }),
    });

    await uploadGeneratedCertificate(firstGenCertAPath, renderA.pdfBytes);
    await prisma.certificate.update({
      where: { id: certificateAId },
      data: {
        status: CertificateStatus.GENERATED,
        generatedFilePath: firstGenCertAPath,
        generatedAt: new Date(),
        generationError: null,
        isStale: false,
      },
    });

    // Simulate worker for Participant B (deterministic domain failure)
    try {
      await renderSingleCertificate({
        template: { fileType: TemplateFileType.PDF, sourceBytes: tplBuffer, pageWidth: 842, pageHeight: 595 },
        placement: namePlacementSchema.parse({ xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.35, alignment: "center" }),
        participant: { name: "Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Senior Third Count of Lichtenstein von Hohenzollern the Great Emperor" },
        font: { fontBytes },
        style: parseFontConfig({ fontSize: 28, minFontSize: 16, lineHeightMultiplier: 1.2, textColor: { r: 0.1, g: 0.1, b: 0.1 } }),
      });
      expect.unreachable();
    } catch (err) {
      expect(isParticipantDomainError(err)).toBe(true);
      const safeError = toSafeGenerationErrorMessage(err);
      await prisma.certificate.update({
        where: { id: certificateBId },
        data: {
          status: CertificateStatus.FAILED,
          generationError: safeError,
          // Phase 10: does not clear generatedFilePath/generatedAt
        },
      });
    }

    // Finalize batch
    const finalize = await checkAndFinalizeBatch(testBatchId, firstGenKey);
    expect(finalize.finalized).toBe(true);

    const batch = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    expect(batch?.status).toBe(BatchStatus.GENERATED);
  });

  it("Step 2: Management query returns correct summary counts and safe errors without exposing storage paths", async () => {
    const data = await getBatchGenerationManagementData(testBatchId);

    expect(data.batch.status).toBe(BatchStatus.GENERATED);
    expect(data.summary.total).toBe(2);
    expect(data.summary.generated).toBe(1);
    expect(data.summary.failed).toBe(1);
    expect(data.summary.pending).toBe(0);
    expect(data.summary.generating).toBe(0);

    const rowA = data.participants.find((p) => p.participantId === participantAId)!;
    expect(rowA.certificateStatus).toBe(CertificateStatus.GENERATED);
    expect(rowA.hasPreviousOutput).toBe(true);
    expect(rowA.isStale).toBe(false);

    const rowB = data.participants.find((p) => p.participantId === participantBId)!;
    expect(rowB.certificateStatus).toBe(CertificateStatus.FAILED);
    expect(rowB.safeGenerationError).toMatch(/^NAME_DOES_NOT_FIT:/);
    expect(rowB.hasPreviousOutput).toBe(false);
  });

  it("Step 3: Individual regeneration of Participant A writes new storage path and preserves old storage file", async () => {
    const batchBefore = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    const regenResult = await regenerateParticipantGeneration(
      testBatchId,
      participantAId,
      batchBefore!.currentGenerationKey
    );

    const secondGenKey = regenResult.generationKey;
    expect(secondGenKey).not.toBe(firstGenKey);

    // Cert A is PENDING with new key, but still retains firstGenCertAPath and isStale = true
    const certAInitial = await prisma.certificate.findUnique({ where: { id: certificateAId } });
    expect(certAInitial?.status).toBe(CertificateStatus.PENDING);
    expect(certAInitial?.generationKey).toBe(secondGenKey);
    expect(certAInitial?.generatedFilePath).toBe(firstGenCertAPath);
    expect(certAInitial?.isStale).toBe(true);

    // Cert B is untouched
    const certB = await prisma.certificate.findUnique({ where: { id: certificateBId } });
    expect(certB?.generationKey).toBe(firstGenKey);
    expect(certB?.status).toBe(CertificateStatus.FAILED);

    // Simulate worker render & upload to second path
    secondGenCertAPath = `certificates/${testBatchId}/${participantAId}/${secondGenKey}.pdf`;
    const tplBuffer = await downloadTemplateBuffer(templateStoragePath);
    const fontBytes = await resolveFontBytes("test-font");

    const renderA2 = await renderSingleCertificate({
      template: { fileType: TemplateFileType.PDF, sourceBytes: tplBuffer, pageWidth: 842, pageHeight: 595 },
      placement: namePlacementSchema.parse({ xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.35, alignment: "center" }),
      participant: { name: "Ahmad Budi Santoso" },
      font: { fontBytes },
      style: parseFontConfig({ fontSize: 28, minFontSize: 16, lineHeightMultiplier: 1.2, textColor: { r: 0.1, g: 0.1, b: 0.1 } }),
    });

    await uploadGeneratedCertificate(secondGenCertAPath, renderA2.pdfBytes);

    // Worker finalizes success
    await prisma.certificate.update({
      where: { id: certificateAId },
      data: {
        status: CertificateStatus.GENERATED,
        generatedFilePath: secondGenCertAPath,
        generatedAt: new Date(),
        generationError: null,
        isStale: false,
      },
    });

    // Batch finalizes
    await checkAndFinalizeBatch(testBatchId, secondGenKey);

    const certAFinal = await prisma.certificate.findUnique({ where: { id: certificateAId } });
    expect(certAFinal?.status).toBe(CertificateStatus.GENERATED);
    expect(certAFinal?.generatedFilePath).toBe(secondGenCertAPath);
    expect(certAFinal?.isStale).toBe(false);

    // Verify Supabase Storage: BOTH old and new files exist
    const supabase = getServerStorageClient();
    const { data: oldFileData } = await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .download(firstGenCertAPath);
    expect(oldFileData).not.toBeNull();

    const { data: newFileData } = await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .download(secondGenCertAPath);
    expect(newFileData).not.toBeNull();
  });

  it("Step 4: Failed regeneration preserves previous successful output and sets isStale = true", async () => {
    const batchBefore = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    const regenResult = await regenerateParticipantGeneration(
      testBatchId,
      participantAId,
      batchBefore!.currentGenerationKey
    );
    const thirdGenKey = regenResult.generationKey;

    // Simulate worker hitting a domain failure on this attempt
    await prisma.certificate.update({
      where: { id: certificateAId },
      data: {
        status: CertificateStatus.FAILED,
        generationError: "NAME_DOES_NOT_FIT: SINGLE_WORD_OVERFLOW",
        // generatedFilePath and generatedAt are untouched (preserve secondGenCertAPath)
      },
    });

    await checkAndFinalizeBatch(testBatchId, thirdGenKey);

    const certA = await prisma.certificate.findUnique({ where: { id: certificateAId } });
    expect(certA?.status).toBe(CertificateStatus.FAILED);
    expect(certA?.generatedFilePath).toBe(secondGenCertAPath); // Preserved!
    expect(certA?.isStale).toBe(true); // Stale flag set!

    // Verify storage object was NOT destroyed
    const supabase = getServerStorageClient();
    const { data: preservedFile } = await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .download(secondGenCertAPath);
    expect(preservedFile).not.toBeNull();
  });

  it("Step 5: Scoped FAILED batch recovery recovers only unfinished certificates", async () => {
    // Manually set batch to FAILED representing an orchestrator crash during an individual retry
    const failedOpKey = "failed-orch-key-123";
    await prisma.certificateBatch.update({
      where: { id: testBatchId },
      data: {
        status: BatchStatus.FAILED,
        currentGenerationKey: failedOpKey,
      },
    });

    // Participant B was part of this failed operation and left in GENERATING
    await prisma.certificate.update({
      where: { id: certificateBId },
      data: {
        status: CertificateStatus.GENERATING,
        generationKey: failedOpKey,
      },
    });

    // Recover batch
    const recoveryResult = await recoverFailedBatchGeneration(testBatchId, failedOpKey);
    expect(recoveryResult.reconciled).toBe(false);

    if (!recoveryResult.reconciled) {
      expect(recoveryResult.recoveredCount).toBe(1); // Only cert B was unfinished
      const recoveryKey = recoveryResult.generationKey;

      // Cert B was reset to PENDING
      const certB = await prisma.certificate.findUnique({ where: { id: certificateBId } });
      expect(certB?.status).toBe(CertificateStatus.PENDING);
      expect(certB?.generationKey).toBe(recoveryKey);

      // Cert A was untouched!
      const certA = await prisma.certificate.findUnique({ where: { id: certificateAId } });
      expect(certA?.generationKey).not.toBe(recoveryKey);

      // Complete cert B and batch
      await prisma.certificate.update({
        where: { id: certificateBId },
        data: { status: CertificateStatus.FAILED, generationError: "RECOVERED_FAILURE" },
      });
      await checkAndFinalizeBatch(testBatchId, recoveryKey);

      const batchFinal = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
      expect(batchFinal?.status).toBe(BatchStatus.GENERATED);
    }
  });
});
