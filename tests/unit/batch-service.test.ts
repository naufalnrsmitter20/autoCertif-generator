import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBatch,
  updateBatchName,
  softDeleteBatch,
  getActiveBatches,
  getActiveBatchById,
  BatchNotFoundError,
} from "@/lib/batches";
import { AdminAuthError } from "@/lib/auth/guard";
import { BatchStatus } from "@/generated/prisma/client";

// Mock dependencies
vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {
    constructor(message = "Unauthorized: ADMIN role required") {
      super(message);
      this.name = "AdminAuthError";
    }
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    certificateBatch: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { requireAdmin } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";

describe("CertificateBatch Service Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      id: "admin-id",
      email: "admin@autocertif.local",
      role: "ADMIN",
    });
  });

  describe("createBatch", () => {
    it("rejects unauthorized caller before database access", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());

      await expect(createBatch({ name: "Summer Workshop" })).rejects.toThrow(
        AdminAuthError
      );
      expect(prisma.certificateBatch.create).not.toHaveBeenCalled();
    });

    it("creates a batch in DRAFT status with null template and publication fields", async () => {
      vi.mocked(prisma.certificateBatch.create).mockResolvedValueOnce({
        id: "batch-1",
        name: "Summer Workshop",
        status: BatchStatus.DRAFT,
        templateId: null,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        template: null,
      } as never);

      const result = await createBatch({ name: "  Summer Workshop  " });

      expect(prisma.certificateBatch.create).toHaveBeenCalledWith({
        data: {
          name: "Summer Workshop",
          status: BatchStatus.DRAFT,
          templateId: null,
          publishedAt: null,
          deletedAt: null,
        },
        include: {
          template: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      expect(result.id).toBe("batch-1");
      expect(result.status).toBe(BatchStatus.DRAFT);
    });
  });

  describe("updateBatchName", () => {
    it("updates batch name for an existing active batch", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        name: "Old Name",
        deletedAt: null,
      } as never);

      vi.mocked(prisma.certificateBatch.update).mockResolvedValueOnce({
        id: "batch-1",
        name: "New Name",
        status: BatchStatus.DRAFT,
        deletedAt: null,
      } as never);

      const updated = await updateBatchName("batch-1", { name: "New Name" });

      expect(prisma.certificateBatch.findFirst).toHaveBeenCalledWith({
        where: {
          id: "batch-1",
          deletedAt: null,
        },
      });
      expect(prisma.certificateBatch.update).toHaveBeenCalledWith({
        where: { id: "batch-1" },
        data: { name: "New Name" },
        include: {
          template: {
            select: { id: true, name: true },
          },
        },
      });
      expect(updated.name).toBe("New Name");
    });

    it("throws BatchNotFoundError if batch is nonexistent or soft-deleted", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);

      await expect(
        updateBatchName("nonexistent-batch", { name: "New Name" })
      ).rejects.toThrow(BatchNotFoundError);
      expect(prisma.certificateBatch.update).not.toHaveBeenCalled();
    });
  });

  describe("softDeleteBatch", () => {
    it("sets deletedAt timestamp and never calls delete", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        name: "Active Batch",
        deletedAt: null,
      } as never);

      vi.mocked(prisma.certificateBatch.update).mockResolvedValueOnce({
        id: "batch-1",
        deletedAt: new Date(),
      } as never);

      await softDeleteBatch("batch-1");

      expect(prisma.certificateBatch.update).toHaveBeenCalledWith({
        where: { id: "batch-1" },
        data: {
          deletedAt: expect.any(Date),
        },
      });
      expect(prisma.certificateBatch.delete).not.toHaveBeenCalled();
    });

    it("throws BatchNotFoundError when attempting to delete an already deleted batch", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);

      await expect(softDeleteBatch("already-deleted")).rejects.toThrow(
        BatchNotFoundError
      );
      expect(prisma.certificateBatch.update).not.toHaveBeenCalled();
    });
  });

  describe("getActiveBatches & getActiveBatchById", () => {
    it("queries only non-deleted batches ordered newest first", async () => {
      vi.mocked(prisma.certificateBatch.findMany).mockResolvedValueOnce([]);

      await getActiveBatches();

      expect(prisma.certificateBatch.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          template: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    it("getActiveBatchById filters by id and deletedAt: null", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);

      const res = await getActiveBatchById("batch-123");

      expect(res).toBeNull();
      expect(prisma.certificateBatch.findFirst).toHaveBeenCalledWith({
        where: {
          id: "batch-123",
          deletedAt: null,
        },
        include: {
          template: {
            select: {
              id: true,
              name: true,
              fileType: true,
              pageWidth: true,
              pageHeight: true,
              sourceFilePath: true,
              namePlacement: true,
              fontFamily: true,
              fontAssetPath: true,
              fontConfig: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              participants: {
                where: { deletedAt: null },
              },
              certificates: {
                where: { deletedAt: null },
              },
            },
          },
        },
      });
    });
  });
});
