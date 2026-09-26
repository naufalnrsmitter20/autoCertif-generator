import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import {
  registerTestFont,
  clearTestFontRegistry,
  resolveFontBytes,
  PRODUCTION_FONT_REGISTRY,
} from "@/lib/rendering/font-registry";
import { executeGenerationPreflight } from "@/lib/generation/preflight";
import { initializeGeneration } from "@/lib/generation/initialize";
import { checkAndFinalizeBatch } from "@/lib/generation/finalization";
import { renderSingleCertificate } from "@/lib/rendering/engine";
import {
  uploadGeneratedCertificate,
  getServerStorageClient,
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

describe("Phase 9 Live Architecture & Supabase Output Integration", { timeout: 45000 }, () => {
  const timestamp = Date.now();
  const testTemplateId = `tpl-live-${timestamp}`;
  const testBatchId = `batch-live-${timestamp}`;
  const templateStoragePath = `templates/${testBatchId}/source.pdf`;

  let participantAId: string;
  let participantBId: string;
  let certificateAId: string;
  let certificateBId: string;
  let activeGenerationKey: string;
  let uploadedCertPath: string | null = null;

  beforeAll(async () => {
    // 1. Enforce test-only font registration in strictly isolated test registry
    expect(Object.keys(PRODUCTION_FONT_REGISTRY)).toHaveLength(0);
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
      throw new Error(`Failed to upload test template to storage: ${uploadError.message}`);
    }

    // 3. Create Template record in DB with deterministic configuration
    await prisma.certificateTemplate.create({
      data: {
        id: testTemplateId,
        name: `Integration Test Template ${timestamp}`,
        fileType: TemplateFileType.PDF,
        sourceFilePath: templateStoragePath,
        pageWidth: 842,
        pageHeight: 595,
        namePlacement: {
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.35, // 0.35 * 842 = ~294 pt allowed width
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
    });

    // 4. Create Batch record in DRAFT status
    await prisma.certificateBatch.create({
      data: {
        id: testBatchId,
        name: `Integration Test Batch ${timestamp}`,
        status: BatchStatus.DRAFT,
        templateId: testTemplateId,
      },
    });

    // 5. Create Participant A (valid, renderable within 294 pt)
    const partA = await prisma.participant.create({
      data: {
        batchId: testBatchId,
        name: "Ahmad Budi Santoso",
      },
    });
    participantAId = partA.id;

    // 6. Create Participant B (deterministic domain failure: too long for 294 pt even at minFontSize 16 and 2 lines)
    const partB = await prisma.participant.create({
      data: {
        batchId: testBatchId,
        name: "Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Senior Third Count of Lichtenstein von Hohenzollern the Great Emperor",
      },
    });
    participantBId = partB.id;
  }, 45000);

  afterAll(async () => {
    clearTestFontRegistry();

    // Cleanup generated certificate from Supabase Storage
    const supabase = getServerStorageClient();
    if (uploadedCertPath) {
      try {
        await supabase.storage
          .from(GENERATED_CERTIFICATES_BUCKET)
          .remove([uploadedCertPath]);
      } catch {
        // ignore cleanup error
      }
    }

    // Cleanup template from Supabase Storage
    try {
      await supabase.storage
        .from(TEMPLATE_STORAGE_BUCKET)
        .remove([templateStoragePath]);
    } catch {
      // ignore cleanup error
    }

    // Cleanup DB records
    try {
      await prisma.certificate.deleteMany({ where: { batchId: testBatchId } });
      await prisma.participant.deleteMany({ where: { batchId: testBatchId } });
      await prisma.certificateBatch.deleteMany({ where: { id: testBatchId } });
      await prisma.certificateTemplate.deleteMany({ where: { id: testTemplateId } });
    } catch {
      // ignore cleanup error
    }
  }, 45000);

  it("Step 1: Preflight succeeds and returns validated snapshot", async () => {
    const snapshot = await executeGenerationPreflight(testBatchId);

    expect(snapshot.batchId).toBe(testBatchId);
    expect(snapshot.templateId).toBe(testTemplateId);
    expect(snapshot.activeParticipants).toHaveLength(2);
    expect(snapshot.fontAssetPath).toBe("test-font");
    expect(snapshot.fontConfig.fontSize).toBe(28);
    expect(snapshot.fontConfig.minFontSize).toBe(16);
  });

  it("Step 2: Initialization transitions DRAFT -> GENERATING and sets dual generationKey", async () => {
    const result = await initializeGeneration(testBatchId);

    expect(result.participantCount).toBe(2);
    expect(result.generationKey).toBeDefined();
    activeGenerationKey = result.generationKey;

    // Verify batch state
    const batch = await prisma.certificateBatch.findUnique({
      where: { id: testBatchId },
    });
    expect(batch?.status).toBe(BatchStatus.GENERATING);
    expect(batch?.currentGenerationKey).toBe(activeGenerationKey);

    // Verify both certificates created in PENDING with matching generationKey
    const certs = await prisma.certificate.findMany({
      where: { batchId: testBatchId },
    });
    expect(certs).toHaveLength(2);

    const certA = certs.find((c) => c.participantId === participantAId)!;
    const certB = certs.find((c) => c.participantId === participantBId)!;

    expect(certA.status).toBe(CertificateStatus.PENDING);
    expect(certA.generationKey).toBe(activeGenerationKey);
    certificateAId = certA.id;

    expect(certB.status).toBe(CertificateStatus.PENDING);
    expect(certB.generationKey).toBe(activeGenerationKey);
    certificateBId = certB.id;
  });

  it("Step 3: Participant A worker execution succeeds and uploads real PDF to live Supabase Storage", async () => {
    // 1. Claim certificate: PENDING -> GENERATING
    const claimResult = await prisma.certificate.updateMany({
      where: {
        id: certificateAId,
        batchId: testBatchId,
        generationKey: activeGenerationKey,
        status: CertificateStatus.PENDING,
        deletedAt: null,
      },
      data: { status: CertificateStatus.GENERATING },
    });
    expect(claimResult.count).toBe(1);

    // 2. Load context and render certificate via Phase 8 rendering engine
    const batch = await prisma.certificateBatch.findFirst({
      where: { id: testBatchId },
      include: { template: true },
    });
    const template = batch!.template!;
    const placement = namePlacementSchema.parse(template.namePlacement);
    const style = parseFontConfig(template.fontConfig);
    const fontBytes = await resolveFontBytes(template.fontAssetPath);

    const supabase = getServerStorageClient();
    const { data: tmplData } = await supabase.storage
      .from(TEMPLATE_STORAGE_BUCKET)
      .download(template.sourceFilePath!);
    const templateBuffer = Buffer.from(await tmplData!.arrayBuffer());

    const partA = await prisma.participant.findUnique({ where: { id: participantAId } });

    const renderResult = await renderSingleCertificate({
      template: {
        fileType: template.fileType,
        sourceBytes: templateBuffer,
        pageWidth: template.pageWidth,
        pageHeight: template.pageHeight,
      },
      placement,
      participant: { name: partA!.name },
      font: { fontBytes },
      style,
    });

    expect(renderResult.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(renderResult.pdfBytes.length).toBeGreaterThan(0);

    // 3. Upload to private Supabase generated-certificates bucket
    const storagePath = `certificates/${testBatchId}/${participantAId}/${activeGenerationKey}.pdf`;
    uploadedCertPath = storagePath;

    await uploadGeneratedCertificate(storagePath, renderResult.pdfBytes);

    // 4. Finalize certificate record for Participant A
    await prisma.certificate.updateMany({
      where: {
        id: certificateAId,
        batchId: testBatchId,
        generationKey: activeGenerationKey,
        status: CertificateStatus.GENERATING,
        deletedAt: null,
      },
      data: {
        status: CertificateStatus.GENERATED,
        generatedFilePath: storagePath,
        generatedAt: new Date(),
        generationError: null,
        isStale: false,
      },
    });

    // 5. Finalization check: Participant B is still pending, so batch stays GENERATING
    const finalizationA = await checkAndFinalizeBatch(testBatchId, activeGenerationKey);
    expect(finalizationA.finalized).toBe(false);
    expect(finalizationA.reason).toBe("still_pending");
    expect(finalizationA.pendingCount).toBe(1);

    const batchMid = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });
    expect(batchMid?.status).toBe(BatchStatus.GENERATING);
  });

  it("Step 4: Participant B worker execution hits deterministic domain failure and transitions to FAILED", async () => {
    // 1. Claim certificate: PENDING -> GENERATING
    const claimResult = await prisma.certificate.updateMany({
      where: {
        id: certificateBId,
        batchId: testBatchId,
        generationKey: activeGenerationKey,
        status: CertificateStatus.PENDING,
        deletedAt: null,
      },
      data: { status: CertificateStatus.GENERATING },
    });
    expect(claimResult.count).toBe(1);

    // 2. Render Participant B -> triggers NameDoesNotFitError
    const batch = await prisma.certificateBatch.findFirst({
      where: { id: testBatchId },
      include: { template: true },
    });
    const template = batch!.template!;
    const placement = namePlacementSchema.parse(template.namePlacement);
    const style = parseFontConfig(template.fontConfig);
    const fontBytes = await resolveFontBytes(template.fontAssetPath);

    const supabase = getServerStorageClient();
    const { data: tmplData } = await supabase.storage
      .from(TEMPLATE_STORAGE_BUCKET)
      .download(template.sourceFilePath!);
    const templateBuffer = Buffer.from(await tmplData!.arrayBuffer());

    const partB = await prisma.participant.findUnique({ where: { id: participantBId } });

    let caughtError: unknown = null;
    try {
      await renderSingleCertificate({
        template: {
          fileType: template.fileType,
          sourceBytes: templateBuffer,
          pageWidth: template.pageWidth,
          pageHeight: template.pageHeight,
        },
        placement,
        participant: { name: partB!.name },
        font: { fontBytes },
        style,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(isParticipantDomainError(caughtError)).toBe(true);

    const safeError = toSafeGenerationErrorMessage(caughtError);
    expect(safeError).toContain("NAME_DOES_NOT_FIT");

    // 3. Mark Certificate B as FAILED (no storage path written)
    await prisma.certificate.updateMany({
      where: {
        id: certificateBId,
        batchId: testBatchId,
        generationKey: activeGenerationKey,
        status: CertificateStatus.GENERATING,
        deletedAt: null,
      },
      data: {
        status: CertificateStatus.FAILED,
        generationError: safeError,
        generatedAt: null,
        generatedFilePath: null,
      },
    });

    // 4. Finalization check: 0 unfinished certificates remain -> batch transitions to GENERATED
    const finalizationB = await checkAndFinalizeBatch(testBatchId, activeGenerationKey);
    expect(finalizationB.finalized).toBe(true);
    expect(finalizationB.reason).toBe("finalized");
    expect(finalizationB.pendingCount).toBe(0);
  });

  it("Step 5: Verifies failure isolation (Participant B does not roll back Participant A)", async () => {
    const certA = await prisma.certificate.findUnique({ where: { id: certificateAId } });
    const certB = await prisma.certificate.findUnique({ where: { id: certificateBId } });
    const batch = await prisma.certificateBatch.findUnique({ where: { id: testBatchId } });

    // Participant A is intact and GENERATED
    expect(certA?.status).toBe(CertificateStatus.GENERATED);
    expect(certA?.generatedFilePath).toBe(uploadedCertPath);
    expect(certA?.generationError).toBeNull();
    expect(certA?.generatedAt).toBeInstanceOf(Date);

    // Participant B is FAILED with error
    expect(certB?.status).toBe(CertificateStatus.FAILED);
    expect(certB?.generatedFilePath).toBeNull();
    expect(certB?.generationError).toContain("NAME_DOES_NOT_FIT");
    expect(certB?.generatedAt).toBeNull();

    // Batch reaches terminal GENERATED state with mixed participants
    expect(batch?.status).toBe(BatchStatus.GENERATED);
    expect(batch?.currentGenerationKey).toBe(activeGenerationKey);
  });

  it("Step 6: Storage verification for live Supabase generated-certificates upload", async () => {
    const supabase = getServerStorageClient();

    // Verify storage path format: certificates/{batchId}/{participantId}/{generationKey}.pdf
    expect(uploadedCertPath).toMatch(
      new RegExp(`^certificates/${testBatchId}/${participantAId}/${activeGenerationKey}\\.pdf$`)
    );

    // Verify no participant name appears in path
    expect(uploadedCertPath).not.toContain("Ahmad");
    expect(uploadedCertPath).not.toContain("Budi");

    // Verify object actually exists in private bucket
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .download(uploadedCertPath!);

    expect(downloadError).toBeNull();
    expect(fileData).not.toBeNull();
    expect(fileData!.type).toContain("application/pdf");

    // Verify generated PDF parses as a valid 1-page PDF
    const downloadedBuffer = await fileData!.arrayBuffer();
    const parsedPdf = await PDFDocument.load(downloadedBuffer);
    expect(parsedPdf.getPageCount()).toBe(1);

    const firstPage = parsedPdf.getPage(0);
    const { width, height } = firstPage.getSize();
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
  });

  it("Step 7: Generation identity protection: stale generationKey cannot mutate state", async () => {
    const staleKey = "stale-generation-key-999";

    // 1. Stale finalization attempt is rejected
    const staleFinalize = await checkAndFinalizeBatch(testBatchId, staleKey);
    expect(staleFinalize.finalized).toBe(false);
    expect(staleFinalize.reason).toBe("stale_attempt");

    // 2. Stale certificate update matches 0 rows
    const staleUpdate = await prisma.certificate.updateMany({
      where: {
        id: certificateAId,
        batchId: testBatchId,
        generationKey: staleKey, // Stale key
      },
      data: { status: CertificateStatus.FAILED },
    });
    expect(staleUpdate.count).toBe(0);

    // 3. Current state remains intact
    const certA = await prisma.certificate.findUnique({ where: { id: certificateAId } });
    expect(certA?.status).toBe(CertificateStatus.GENERATED);
  });
});
