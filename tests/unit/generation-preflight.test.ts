/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeGenerationPreflight } from "@/lib/generation/preflight";
import { prisma } from "@/lib/prisma";
import { BatchStatus, TemplateFileType } from "@/generated/prisma/client";
import { GenerationPreflightError } from "@/lib/generation/errors";
import * as storage from "@/lib/storage/server";
import * as fontRegistry from "@/lib/rendering/font-registry";
import { PDFDocument } from "pdf-lib";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    certificateBatch: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/storage/server", () => ({
  downloadTemplateBuffer: vi.fn(),
}));

vi.mock("@/lib/rendering/font-registry", () => ({
  resolveFontBytes: vi.fn(),
}));

describe("executeGenerationPreflight", () => {
  const batchId = "batch-1";
  const validPlacement = {
    xRatio: 0.5,
    yRatio: 0.5,
    maxWidthRatio: 0.4,
    alignment: "center" as const,
  };
  const validFontConfig = {
    fontSize: 28,
    minFontSize: 14,
    lineHeightMultiplier: 1.2,
    textColor: { r: 0.1, g: 0.1, b: 0.1 },
    stepSize: 1.0,
  };

  async function createValidSinglePagePdfBuffer(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]); // landscape A4
    return Buffer.from(await doc.save());
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when batch does not exist", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue(null);

    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      GenerationPreflightError
    );
    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      /Certificate batch not found/
    );
  });

  it("throws when batch is not in DRAFT status", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.GENERATING,
      deletedAt: null,
      template: null,
      participants: [],
    } as any);

    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      /Initial bulk generation can only be started for batches in DRAFT status/
    );
  });

  it("throws when batch has no active template", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.DRAFT,
      deletedAt: null,
      template: null,
      participants: [],
    } as any);

    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      /No active certificate template is configured/
    );
  });

  it("throws when template has no namePlacement", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.DRAFT,
      deletedAt: null,
      template: {
        id: "t1",
        sourceFilePath: "templates/source.pdf",
        namePlacement: null,
      },
      participants: [],
    } as any);

    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      /Participant name placement has not been configured/
    );
  });

  it("throws when fontAssetPath is missing or unresolvable", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.DRAFT,
      deletedAt: null,
      template: {
        id: "t1",
        sourceFilePath: "templates/source.pdf",
        namePlacement: validPlacement,
        fontAssetPath: null,
        fontConfig: validFontConfig,
      },
      participants: [{ id: "p1", name: "Alice" }],
    } as any);

    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      /Deterministic font asset is not configured/
    );
  });

  it("throws when fontConfig is missing or invalid", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.DRAFT,
      deletedAt: null,
      template: {
        id: "t1",
        sourceFilePath: "templates/source.pdf",
        namePlacement: validPlacement,
        fontAssetPath: "test-font",
        fontConfig: null,
      },
      participants: [{ id: "p1", name: "Alice" }],
    } as any);

    vi.mocked(fontRegistry.resolveFontBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      /Typography rendering style .* is not configured/
    );
  });

  it("throws when batch has 0 active participants", async () => {
    const pdfBytes = await createValidSinglePagePdfBuffer();
    vi.mocked(storage.downloadTemplateBuffer).mockResolvedValue(pdfBytes);
    vi.mocked(fontRegistry.resolveFontBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      name: "Batch 1",
      status: BatchStatus.DRAFT,
      deletedAt: null,
      template: {
        id: "t1",
        name: "Template 1",
        fileType: TemplateFileType.PDF,
        sourceFilePath: "templates/source.pdf",
        namePlacement: validPlacement,
        fontAssetPath: "test-font",
        fontConfig: validFontConfig,
        updatedAt: new Date(),
        deletedAt: null,
      },
      participants: [],
    } as any);

    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      /Cannot generate certificates for a batch with 0 participants/
    );
  });

  it("throws when PDF template has multiple pages (>1)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]);
    doc.addPage([842, 595]); // 2 pages
    const multiPagePdf = Buffer.from(await doc.save());

    vi.mocked(storage.downloadTemplateBuffer).mockResolvedValue(multiPagePdf);
    vi.mocked(fontRegistry.resolveFontBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      name: "Batch 1",
      status: BatchStatus.DRAFT,
      deletedAt: null,
      template: {
        id: "t1",
        name: "Template 1",
        fileType: TemplateFileType.PDF,
        sourceFilePath: "templates/source.pdf",
        namePlacement: validPlacement,
        fontAssetPath: "test-font",
        fontConfig: validFontConfig,
        updatedAt: new Date(),
        deletedAt: null,
      },
      participants: [{ id: "p1", name: "Alice" }],
    } as any);

    await expect(executeGenerationPreflight(batchId)).rejects.toThrow(
      /PDF template must be exactly 1 page/
    );
  });

  it("passes preflight for valid batch and returns snapshot", async () => {
    const pdfBytes = await createValidSinglePagePdfBuffer();
    vi.mocked(storage.downloadTemplateBuffer).mockResolvedValue(pdfBytes);
    vi.mocked(fontRegistry.resolveFontBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const updatedAt = new Date();
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      name: "Graduation 2026",
      status: BatchStatus.DRAFT,
      deletedAt: null,
      template: {
        id: "t1",
        name: "Template 1",
        fileType: TemplateFileType.PDF,
        sourceFilePath: "templates/source.pdf",
        namePlacement: validPlacement,
        fontAssetPath: "test-font",
        fontConfig: validFontConfig,
        updatedAt,
        deletedAt: null,
      },
      participants: [
        { id: "p1", name: "  Budi Santoso  " },
        { id: "p2", name: "Siti Rahma" },
      ],
    } as any);

    const snapshot = await executeGenerationPreflight(batchId);

    expect(snapshot.batchId).toBe(batchId);
    expect(snapshot.templateId).toBe("t1");
    expect(snapshot.activeParticipants).toHaveLength(2);
    expect(snapshot.activeParticipants[0].normalizedName).toBe("Budi Santoso");
    expect(snapshot.fontConfig.fontSize).toBe(28);
  });
});
