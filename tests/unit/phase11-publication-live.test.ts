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
  getPublishPreflight,
  publishBatch,
  unpublishBatch,
  editPublishedParticipantName,
} from "@/lib/publication/service";

describe("Phase 11 Live Architecture & Supabase Output Integration", { timeout: 60000 }, () => {
  const timestamp = Date.now();
  const testTemplateId = `tpl-live-p11-${timestamp}`;
  const testBatchId = `batch-live-p11-${timestamp}`;
  const templateStoragePath = `templates/${testBatchId}/source.pdf`;

  let participantAId: string;
  let participantBId: string;
  let certificateAId: string;
  let certificateBId: string;
  let firstGenKey: string;
  let secondGenKey: string;
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
    // 1. Enforce test-only font registration in strictly isolated test registry
    expect(Object.keys(PRODUCTION_FONT_REGISTRY)).toHaveLength(0);
    registerTestFont("test-font", "tests/fixtures/fonts/test-font.ttf");

    // 2. Upload real single-page A4 landscape PDF template to private bucket
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

    // 3. Create Template record in DB with strict bounds
    await withRetry(() =>
      prisma.certificateTemplate.create({
        data: {
          id: testTemplateId,
          name: `Phase 11 Test Template ${timestamp}`,
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

    // 4. Create Batch in DRAFT status
    await withRetry(() =>
      prisma.certificateBatch.create({
        data: {
          id: testBatchId,
          name: `Phase 11 Test Batch ${timestamp}`,
          status: BatchStatus.DRAFT,
          templateId: testTemplateId,
        },
      })
    );

    // 5. Create 2 Participants:
    // Participant A fits easily
    const partA = await withRetry(() =>
      prisma.participant.create({
        data: {
          batchId: testBatchId,
          name: "Ahmad Budi Santoso",
        },
      })
    );
    participantAId = partA.id;

    // Participant B has an extraordinarily long name that cannot fit within 35% maxWidth
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

  it("Step 1: Initial generation produces 1 GENERATED, 1 FAILED, batch reaches GENERATED", async () => {
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

    const template = await prisma.certificateTemplate.findUniqueOrThrow({
      where: { id: testTemplateId },
    });
    const templateBytes = await downloadTemplateBuffer(template.sourceFilePath!);
    const placement = namePlacementSchema.parse(template.namePlacement);
    const fontConfig = parseFontConfig(template.fontConfig);
    const fontBytes = await resolveFontBytes(template.fontAssetPath!);

    // Render Participant A (Success)
    const renderA = await renderSingleCertificate({
      template: {
        fileType: template.fileType as "PDF" | "PNG" | "JPG",
        sourceBytes: templateBytes,
        pageWidth: template.pageWidth,
        pageHeight: template.pageHeight,
      },
      placement,
      style: fontConfig,
      participant: { name: "Ahmad Budi Santoso" },
      font: { fontBytes, fontFamily: template.fontFamily ?? undefined },
    });

    firstGenCertAPath = `certificates/${testBatchId}/${participantAId}/${firstGenKey}.pdf`;
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

    // Render Participant B (Fails name fitting)
    try {
      await renderSingleCertificate({
        template: {
          fileType: template.fileType as "PDF" | "PNG" | "JPG",
          sourceBytes: templateBytes,
          pageWidth: template.pageWidth,
          pageHeight: template.pageHeight,
        },
        placement,
        style: fontConfig,
        participant: {
          name: "Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Senior Third Count of Lichtenstein von Hohenzollern the Great Emperor",
        },
        font: { fontBytes, fontFamily: template.fontFamily ?? undefined },
      });
      expect.unreachable("Participant B should have failed name fitting");
    } catch (err) {
      expect(isParticipantDomainError(err)).toBe(true);
      await prisma.certificate.update({
        where: { id: certificateBId },
        data: {
          status: CertificateStatus.FAILED,
          generationError: toSafeGenerationErrorMessage(err),
        },
      });
    }

    // Finalize batch
    const fin = await checkAndFinalizeBatch(testBatchId, firstGenKey);
    expect(fin.finalized).toBe(true);

    const batch = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    expect(batch?.status).toBe(BatchStatus.GENERATED);
    expect(batch?.publishedAt).toBeNull();
  });

  it("Step 2: Preflight surfaces failures, publish creates atomic snapshots and sets PUBLISHED", async () => {
    // 1. Preflight check
    const preflight = await getPublishPreflight(testBatchId);
    expect(preflight.canPublish).toBe(true);
    expect(preflight.eligibleCount).toBe(1);
    expect(preflight.failedCount).toBe(1);
    expect(preflight.failedParticipantNames).toContain(
      "Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Senior Third Count of Lichtenstein von Hohenzollern the Great Emperor"
    );

    // 2. Publish batch
    const pubResult = await publishBatch(testBatchId, firstGenKey);
    expect(pubResult.publishedCount).toBe(1);
    expect(pubResult.ineligibleCount).toBe(1);

    // 3. Verify batch in DB
    const batch = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    expect(batch?.status).toBe(BatchStatus.PUBLISHED);
    expect(batch?.publishedAt).not.toBeNull();

    // 4. Verify participant A certificate snapshot
    const certA = await prisma.certificate.findUnique({ where: { id: certificateAId } });
    expect(certA?.publishedName).toBe("Ahmad Budi Santoso");
    expect(certA?.publishedFilePath).toBe(firstGenCertAPath);

    // 5. Verify participant B certificate has NO publication snapshot
    const certB = await prisma.certificate.findUnique({ where: { id: certificateBId } });
    expect(certB?.publishedName).toBeNull();
    expect(certB?.publishedFilePath).toBeNull();

    // 6. Verify bucket isolation: bucket must be private
    const supabase = getServerStorageClient();
    const { data: bucketData } = await supabase.storage.getBucket(GENERATED_CERTIFICATES_BUCKET);
    expect(bucketData?.public).toBe(false);
  });

  it("Step 3: Safe published edit preserves old snapshot while replacement is GENERATING", async () => {
    const editResult = await editPublishedParticipantName(
      testBatchId,
      participantAId,
      "Ahmad Budi Santoso Updated",
      firstGenKey
    );

    secondGenKey = editResult.generationKey;
    expect(secondGenKey).not.toBe(firstGenKey);
    expect(editResult.newName).toBe("Ahmad Budi Santoso Updated");
    expect(editResult.previousPublishedName).toBe("Ahmad Budi Santoso");

    // 1. Participant name in DB updated
    const partA = await prisma.participant.findUnique({ where: { id: participantAId } });
    expect(partA?.name).toBe("Ahmad Budi Santoso Updated");

    // 2. Batch is GENERATING under secondGenKey, but publishedAt is STILL set
    const batch = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    expect(batch?.status).toBe(BatchStatus.GENERATING);
    expect(batch?.publishedAt).not.toBeNull();
    expect(batch?.currentGenerationKey).toBe(secondGenKey);

    // 3. Target Certificate is PENDING and isStale = true, BUT retains old publication snapshot!
    const certA = await prisma.certificate.findUnique({ where: { id: certificateAId } });
    expect(certA?.status).toBe(CertificateStatus.PENDING);
    expect(certA?.isStale).toBe(true);
    expect(certA?.generationKey).toBe(secondGenKey);
    expect(certA?.publishedName).toBe("Ahmad Budi Santoso"); // OLD SNAPSHOT PRESERVED
    expect(certA?.publishedFilePath).toBe(firstGenCertAPath); // OLD FILE PATH PRESERVED
  });

  it("Step 4: Replacement success cuts over publication snapshots, batch returns to PUBLISHED", async () => {
    const template = await prisma.certificateTemplate.findUniqueOrThrow({
      where: { id: testTemplateId },
    });
    const templateBytes = await downloadTemplateBuffer(template.sourceFilePath!);
    const placement = namePlacementSchema.parse(template.namePlacement);
    const fontConfig = parseFontConfig(template.fontConfig);
    const fontBytes = await resolveFontBytes(template.fontAssetPath!);

    // Render replacement certificate for Ahmad Budi Santoso Updated
    const renderNew = await renderSingleCertificate({
      template: {
        fileType: template.fileType as "PDF" | "PNG" | "JPG",
        sourceBytes: templateBytes,
        pageWidth: template.pageWidth,
        pageHeight: template.pageHeight,
      },
      placement,
      style: fontConfig,
      participant: { name: "Ahmad Budi Santoso Updated" },
      font: { fontBytes, fontFamily: template.fontFamily ?? undefined },
    });

    secondGenCertAPath = `certificates/${testBatchId}/${participantAId}/${secondGenKey}.pdf`;
    await uploadGeneratedCertificate(secondGenCertAPath, renderNew.pdfBytes);

    // Simulate worker step 3 (publication-aware cutover)
    const batchBeforeWorker = await prisma.certificateBatch.findUnique({
      where: { id: testBatchId },
      select: { publishedAt: true },
    });
    expect(batchBeforeWorker?.publishedAt).not.toBeNull();

    await prisma.certificate.update({
      where: { id: certificateAId },
      data: {
        status: CertificateStatus.GENERATED,
        generatedFilePath: secondGenCertAPath,
        generatedAt: new Date(),
        generationError: null,
        isStale: false,
        publishedName: "Ahmad Budi Santoso Updated",
        publishedFilePath: secondGenCertAPath,
      },
    });

    // Run checkAndFinalizeBatch
    const fin = await checkAndFinalizeBatch(testBatchId, secondGenKey);
    expect(fin.finalized).toBe(true);

    // Batch returns to PUBLISHED (not GENERATED) because publishedAt != null
    const batchAfter = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    expect(batchAfter?.status).toBe(BatchStatus.PUBLISHED);
    expect(batchAfter?.publishedAt).not.toBeNull();

    // Verify both files still exist in storage (old file was NOT deleted)
    const supabase = getServerStorageClient();
    const { data: oldFileBlob } = await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .download(firstGenCertAPath);
    expect(oldFileBlob).not.toBeNull();

    const { data: newFileBlob } = await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .download(secondGenCertAPath);
    expect(newFileBlob).not.toBeNull();
  });

  it("Step 5: Immediate unpublish kill-switch clears publishedAt without deleting storage objects", async () => {
    const unpubResult = await unpublishBatch(testBatchId);
    expect(unpubResult.unpublished).toBe(true);

    const batch = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    expect(batch?.status).toBe(BatchStatus.GENERATED);
    expect(batch?.publishedAt).toBeNull();

    // Verify storage files were NOT deleted
    const supabase = getServerStorageClient();
    const { data: file1 } = await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .download(firstGenCertAPath);
    expect(file1).not.toBeNull();

    const { data: file2 } = await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .download(secondGenCertAPath);
    expect(file2).not.toBeNull();
  });

  it("Step 6: Republish rebuilds snapshots from current eligibility", async () => {
    const repubResult = await publishBatch(testBatchId, secondGenKey);
    expect(repubResult.publishedCount).toBe(1);
    expect(repubResult.ineligibleCount).toBe(1);

    const batch = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    expect(batch?.status).toBe(BatchStatus.PUBLISHED);
    expect(batch?.publishedAt).not.toBeNull();

    const certA = await prisma.certificate.findUnique({ where: { id: certificateAId } });
    expect(certA?.publishedName).toBe("Ahmad Budi Santoso Updated");
    expect(certA?.publishedFilePath).toBe(secondGenCertAPath);

    const certB = await prisma.certificate.findUnique({ where: { id: certificateBId } });
    expect(certB?.publishedName).toBeNull();
    expect(certB?.publishedFilePath).toBeNull();
  });
});
