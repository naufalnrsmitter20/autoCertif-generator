/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initializeGeneration,
  getRecoverableDispatchKey,
} from "@/lib/generation/initialize";
import { prisma } from "@/lib/prisma";
import { BatchStatus, CertificateStatus, TemplateFileType } from "@/generated/prisma/client";
import { ConcurrentGenerationConflictError } from "@/lib/generation/errors";
import * as preflight from "@/lib/generation/preflight";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    certificateBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    certificate: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/generation/preflight", () => ({
  executeGenerationPreflight: vi.fn(),
}));

describe("initializeGeneration & getRecoverableDispatchKey", () => {
  const batchId = "batch-1";
  const templateId = "template-1";
  const templateUpdatedAt = new Date("2026-09-26T12:00:00Z");

  const mockSnapshot: preflight.ValidatedPreflightSnapshot = {
    batchId,
    batchName: "Graduation Batch",
    templateId,
    templateUpdatedAt,
    templateFileType: TemplateFileType.PDF,
    templateSourceFilePath: "templates/src.pdf",
    namePlacement: { xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.5, alignment: "center" },
    fontConfig: {
      fontSize: 28,
      minFontSize: 14,
      lineHeightMultiplier: 1.2,
      textColor: { r: 0, g: 0, b: 0 },
      stepSize: 1,
    },
    fontAssetPath: "test-font",
    activeParticipants: [
      { id: "p1", name: "Alice", normalizedName: "Alice" },
      { id: "p2", name: "Bob", normalizedName: "Bob" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initializeGeneration", () => {
    it("aborts when batch status is modified concurrently inside transaction", async () => {
      vi.mocked(preflight.executeGenerationPreflight).mockResolvedValue(mockSnapshot);

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          certificateBatch: {
            findFirst: vi.fn().mockResolvedValue({
              id: batchId,
              status: BatchStatus.GENERATING, // Modified concurrently!
              templateId,
            }),
          },
        };
        return callback(tx);
      });

      await expect(initializeGeneration(batchId)).rejects.toThrow(
        ConcurrentGenerationConflictError
      );
      await expect(initializeGeneration(batchId)).rejects.toThrow(
        /Batch status changed concurrently/
      );
    });

    it("aborts when template configuration is modified concurrently", async () => {
      vi.mocked(preflight.executeGenerationPreflight).mockResolvedValue(mockSnapshot);

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          certificateBatch: {
            findFirst: vi.fn().mockResolvedValue({
              id: batchId,
              status: BatchStatus.DRAFT,
              templateId,
            }),
          },
          certificateTemplate: {
            findFirst: vi.fn().mockResolvedValue({
              id: templateId,
              updatedAt: new Date("2026-09-26T12:05:00Z"), // Different timestamp!
            }),
          },
        };
        return callback(tx);
      });

      await expect(initializeGeneration(batchId)).rejects.toThrow(
        /Template configuration was modified concurrently/
      );
    });

    it("aborts when participant count is modified concurrently", async () => {
      vi.mocked(preflight.executeGenerationPreflight).mockResolvedValue(mockSnapshot);

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          certificateBatch: {
            findFirst: vi.fn().mockResolvedValue({
              id: batchId,
              status: BatchStatus.DRAFT,
              templateId,
            }),
          },
          certificateTemplate: {
            findFirst: vi.fn().mockResolvedValue({
              id: templateId,
              updatedAt: templateUpdatedAt,
            }),
          },
          participant: {
            findMany: vi.fn().mockResolvedValue([
              { id: "p1" },
              { id: "p2" },
              { id: "p3" }, // Concurrently added participant!
            ]),
          },
        };
        return callback(tx);
      });

      await expect(initializeGeneration(batchId)).rejects.toThrow(
        /Participant list was modified concurrently/
      );
    });

    it("atomically upserts Certificate rows and transitions batch to GENERATING", async () => {
      vi.mocked(preflight.executeGenerationPreflight).mockResolvedValue(mockSnapshot);

      const mockUpsert = vi.fn().mockResolvedValue({});
      const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const tx = {
          certificateBatch: {
            findFirst: vi.fn().mockResolvedValue({
              id: batchId,
              status: BatchStatus.DRAFT,
              templateId,
            }),
            updateMany: mockUpdateMany,
          },
          certificateTemplate: {
            findFirst: vi.fn().mockResolvedValue({
              id: templateId,
              updatedAt: templateUpdatedAt,
            }),
          },
          participant: {
            findMany: vi.fn().mockResolvedValue([{ id: "p1" }, { id: "p2" }]),
          },
          certificate: {
            upsert: mockUpsert,
          },
        };
        return callback(tx);
      });

      const result = await initializeGeneration(batchId);

      expect(result.participantCount).toBe(2);
      expect(result.generationKey).toBeDefined();
      expect(typeof result.generationKey).toBe("string");

      // Verify Certificates upserted for each participant with generationKey
      expect(mockUpsert).toHaveBeenCalledTimes(2);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { participantId: "p1" },
          create: expect.objectContaining({
            status: CertificateStatus.PENDING,
            generationKey: result.generationKey,
          }),
        })
      );

      // Verify batch transitioned to GENERATING with currentGenerationKey
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          id: batchId,
          status: BatchStatus.DRAFT,
          deletedAt: null,
        },
        data: {
          status: BatchStatus.GENERATING,
          currentGenerationKey: result.generationKey,
        },
      });
    });
  });

  describe("getRecoverableDispatchKey", () => {
    it("returns canResume: true when batch is GENERATING and all certificates are PENDING", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATING,
        currentGenerationKey: "key-123",
      } as any);

      vi.mocked(prisma.certificate.findMany).mockResolvedValue([
        { status: CertificateStatus.PENDING },
        { status: CertificateStatus.PENDING },
      ] as any);

      const res = await getRecoverableDispatchKey(batchId);
      expect(res.canResume).toBe(true);
      expect(res.generationKey).toBe("key-123");
    });

    it("returns canResume: false when batch is already GENERATED", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: "key-123",
      } as any);

      const res = await getRecoverableDispatchKey(batchId);
      expect(res.canResume).toBe(false);
      expect(res.reason).toMatch(/not GENERATING/);
    });

    it("returns canResume: false when some certificates are already in progress or completed", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATING,
        currentGenerationKey: "key-123",
      } as any);

      vi.mocked(prisma.certificate.findMany).mockResolvedValue([
        { status: CertificateStatus.PENDING },
        { status: CertificateStatus.GENERATED }, // Already started/finished!
      ] as any);

      const res = await getRecoverableDispatchKey(batchId);
      expect(res.canResume).toBe(false);
      expect(res.reason).toMatch(/actively in progress/);
    });
  });
});
