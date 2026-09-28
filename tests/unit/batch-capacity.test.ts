import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    id: "test-admin-id",
    email: "admin@autocertif.local",
    role: "ADMIN",
  }),
  AdminAuthError: class AdminAuthError extends Error {},
}));

import { prisma } from "@/lib/prisma";
import { importParticipants } from "@/lib/participants/service";
import { initializeGeneration } from "@/lib/generation/initialize";
import { registerTestFont, clearTestFontRegistry } from "@/lib/rendering/font-registry";
import { getServerStorageClient } from "@/lib/storage/server";
import { TEMPLATE_STORAGE_BUCKET } from "@/lib/storage/constants";
import { BatchStatus, CertificateStatus, TemplateFileType } from "@/generated/prisma/client";
import { PDFDocument } from "pdf-lib";

describe("Batch Capacity & ~100 Participant Scalability", { timeout: 90000 }, () => {
  const timestamp = Date.now();
  const testBatchId = `batch-capacity-${timestamp}`;
  const testTemplateId = `tpl-capacity-${timestamp}`;
  const templateStoragePath = `templates/${testBatchId}/source.pdf`;

  beforeAll(async () => {
    // 1. Register test font in isolated test registry
    registerTestFont("test-font", "tests/fixtures/fonts/test-font.ttf");

    // 2. Upload real single-page A4 landscape PDF template to private bucket
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([842, 595]);
    const pdfBytes = await pdfDoc.save();

    const supabase = getServerStorageClient();
    const { error: uploadError } = await supabase.storage
      .from(TEMPLATE_STORAGE_BUCKET)
      .upload(templateStoragePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload test template: ${uploadError.message}`);
    }

    // 3. Create Template record in DB
    await prisma.certificateTemplate.create({
      data: {
        id: testTemplateId,
        name: "Capacity Test Template",
        fileType: TemplateFileType.PDF,
        sourceFilePath: templateStoragePath,
        pageWidth: 842,
        pageHeight: 595,
        namePlacement: {
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.8,
          alignment: "center",
        },
        fontAssetPath: "test-font",
        fontConfig: {
          fontSize: 28,
          minFontSize: 14,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
          stepSize: 1,
        },
      },
    });

    // 4. Create DRAFT Batch record in DB
    await prisma.certificateBatch.create({
      data: {
        id: testBatchId,
        name: `Capacity Batch ${timestamp}`,
        status: BatchStatus.DRAFT,
        templateId: testTemplateId,
      },
    });
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    try { await prisma.certificate.deleteMany({ where: { batchId: testBatchId } }); } catch (error) { cleanupErrors.push(error); }
    try { await prisma.participant.deleteMany({ where: { batchId: testBatchId } }); } catch (error) { cleanupErrors.push(error); }
    try { await prisma.certificateBatch.deleteMany({ where: { id: testBatchId } }); } catch (error) { cleanupErrors.push(error); }
    try { await prisma.certificateTemplate.deleteMany({ where: { id: testTemplateId } }); } catch (error) { cleanupErrors.push(error); }
    try {
      const supabase = getServerStorageClient();
      const { error } = await supabase.storage.from(TEMPLATE_STORAGE_BUCKET).remove([templateStoragePath]);
      if (error) cleanupErrors.push(error);
    } catch (error) {
      cleanupErrors.push(error);
    }

    clearTestFontRegistry();
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Capacity test cleanup failed");
  });

  it("imports exactly 100 participants and initializes generation for all 100 without truncation", async () => {
    const TOTAL_PARTICIPANTS = 100;

    // 1. Generate 100 realistic Indonesian student names
    const names = Array.from({ length: TOTAL_PARTICIPANTS }, (_, i) => {
      const pad = String(i + 1).padStart(3, "0");
      return `Peserta Uji Kapasitas Nomor ${pad}`;
    });

    // 2. Import 100 participants via production service importParticipants
    const importResult = await importParticipants(testBatchId, names);
    expect(importResult.count).toBe(TOTAL_PARTICIPANTS);

    // 3. Verify exactly 100 active participants are persisted
    const activeParticipantsCount = await prisma.participant.count({
      where: { batchId: testBatchId, deletedAt: null },
    });
    expect(activeParticipantsCount).toBe(TOTAL_PARTICIPANTS);

    // 4. Exercise bulk generation initialization using the production signature initializeGeneration(batchId)
    const initResult = await initializeGeneration(testBatchId);
    expect(initResult.participantCount).toBe(TOTAL_PARTICIPANTS);
    expect(typeof initResult.generationKey).toBe("string");
    expect(initResult.generationKey.length).toBeGreaterThan(0);

    // 5. Verify batch transitioned to GENERATING with currentGenerationKey
    const updatedBatch = await prisma.certificateBatch.findUnique({
      where: { id: testBatchId },
    });
    expect(updatedBatch?.status).toBe(BatchStatus.GENERATING);
    expect(updatedBatch?.currentGenerationKey).toBe(initResult.generationKey);

    // 6. Verify exactly 100 Certificate work records are created in PENDING status
    const certificateCount = await prisma.certificate.count({
      where: {
        batchId: testBatchId,
        generationKey: initResult.generationKey,
        status: CertificateStatus.PENDING,
        deletedAt: null,
      },
    });
    expect(certificateCount).toBe(TOTAL_PARTICIPANTS);

    // 7. Verify no fixed truncation occurred: all 100 distinct participants have a matching certificate
    const certificates = await prisma.certificate.findMany({
      where: { batchId: testBatchId, generationKey: initResult.generationKey },
      select: { participantId: true },
    });
    const uniqueParticipantIds = new Set(certificates.map((c) => c.participantId));
    expect(uniqueParticipantIds.size).toBe(TOTAL_PARTICIPANTS);

  });
});
