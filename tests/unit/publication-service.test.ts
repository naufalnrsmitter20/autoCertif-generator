/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getPublishPreflight,
  publishBatch,
  unpublishBatch,
} from "@/lib/publication/service";
import {
  BatchNotEligibleForPublicationError,
  ConcurrentPublicationConflictError,
  ZeroEligibleCertificatesError,
} from "@/lib/publication/errors";
import { BatchNotFoundError } from "@/lib/batches";
import { AdminAuthError } from "@/lib/auth/guard";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";

// Mock auth guard
vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {
    constructor(message = "Unauthorized: ADMIN role required") {
      super(message);
      this.name = "AdminAuthError";
    }
  },
}));

// Mock prisma
vi.mock("@/lib/prisma", () => {
  const prismaMock = {
    certificateBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    participant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    certificate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(prismaMock)),
  };
  return { prisma: prismaMock };
});

import { requireAdmin } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";

describe("Publication Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      id: "admin-id",
      email: "admin@autocertif.local",
      role: "ADMIN",
    });
  });

  describe("getPublishPreflight", () => {
    it("rejects unauthorized access", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
      await expect(getPublishPreflight("batch-1")).rejects.toThrow(AdminAuthError);
    });

    it("throws BatchNotFoundError if batch does not exist", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);
      await expect(getPublishPreflight("nonexistent")).rejects.toThrow(BatchNotFoundError);
    });

    it("rejects batches that are not in GENERATED status", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        name: "Test Batch",
        status: BatchStatus.DRAFT,
        publishedAt: null,
        currentGenerationKey: "key-1",
        templateId: "tpl-1",
      } as any);

      await expect(getPublishPreflight("batch-1")).rejects.toThrow(
        BatchNotEligibleForPublicationError
      );
    });

    it("rejects batches that are already published", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        name: "Test Batch",
        status: BatchStatus.GENERATED,
        publishedAt: new Date(),
        currentGenerationKey: "key-1",
        templateId: "tpl-1",
      } as any);

      await expect(getPublishPreflight("batch-1")).rejects.toThrow(
        BatchNotEligibleForPublicationError
      );
    });

    it("rejects batches without a configured template", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        name: "Test Batch",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "key-1",
        templateId: null,
      } as any);

      await expect(getPublishPreflight("batch-1")).rejects.toThrow(
        BatchNotEligibleForPublicationError
      );
    });

    it("calculates 100% eligible certificates correctly", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        name: "Graduation 2026",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "key-1",
        templateId: "tpl-1",
      } as any);

      vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([
        {
          id: "p1",
          name: "Alice",
          certificate: {
            id: "c1",
            status: CertificateStatus.GENERATED,
            generatedFilePath: "certificates/batch-1/p1/key-1.pdf",
            generatedAt: new Date(),
            isStale: false,
          },
        },
        {
          id: "p2",
          name: "Bob",
          certificate: {
            id: "c2",
            status: CertificateStatus.GENERATED,
            generatedFilePath: "certificates/batch-1/p2/key-1.pdf",
            generatedAt: new Date(),
            isStale: false,
          },
        },
      ] as any);

      const result = await getPublishPreflight("batch-1");
      expect(result.canPublish).toBe(true);
      expect(result.eligibleCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.failedParticipantNames).toEqual([]);
    });

    it("surfaces failed participant names and identifies stale certificates as ineligible", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        name: "Graduation 2026",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "key-1",
        templateId: "tpl-1",
      } as any);

      vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([
        {
          id: "p1",
          name: "Alice",
          certificate: {
            id: "c1",
            status: CertificateStatus.GENERATED,
            generatedFilePath: "certificates/batch-1/p1/key-1.pdf",
            generatedAt: new Date(),
            isStale: false,
          },
        },
        {
          id: "p2",
          name: "Charlie Extremely Long Name",
          certificate: {
            id: "c2",
            status: CertificateStatus.FAILED,
            generatedFilePath: null,
            generatedAt: null,
            isStale: true,
          },
        },
        {
          id: "p3",
          name: "David",
          certificate: {
            id: "c3",
            status: CertificateStatus.GENERATED,
            generatedFilePath: "certificates/batch-1/p3/old-key.pdf",
            generatedAt: new Date(),
            isStale: true, // Stale!
          },
        },
      ] as any);

      const result = await getPublishPreflight("batch-1");
      expect(result.canPublish).toBe(true);
      expect(result.eligibleCount).toBe(1);
      expect(result.failedCount).toBe(2);
      expect(result.failedParticipantNames).toEqual(["Charlie Extremely Long Name", "David"]);
    });
  });

  describe("publishBatch", () => {
    it("rejects unauthorized access", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
      await expect(publishBatch("batch-1", "key-1")).rejects.toThrow(AdminAuthError);
    });

    it("rejects when batch has 0 eligible certificates", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "key-1",
        templateId: "tpl-1",
      } as any);

      vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([
        {
          id: "p1",
          name: "Charlie",
          certificate: {
            id: "c1",
            status: CertificateStatus.FAILED,
            generatedFilePath: null,
            generatedAt: null,
            isStale: true,
          },
        },
      ] as any);

      await expect(publishBatch("batch-1", "key-1")).rejects.toThrow(
        ZeroEligibleCertificatesError
      );
    });

    it("rejects on stale expectedCurrentGenerationKey CAS mismatch", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "newer-key",
        templateId: "tpl-1",
      } as any);

      await expect(publishBatch("batch-1", "stale-key")).rejects.toThrow(
        ConcurrentPublicationConflictError
      );
    });

    it("atomically snapshots eligible certificates, sets publishedAt and status PUBLISHED", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "key-1",
        templateId: "tpl-1",
      } as any);

      vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([
        {
          id: "p1",
          name: "Alice",
          certificate: {
            id: "c1",
            status: CertificateStatus.GENERATED,
            generatedFilePath: "certificates/batch-1/p1/key-1.pdf",
            generatedAt: new Date(),
            isStale: false,
          },
        },
        {
          id: "p2",
          name: "Bob",
          certificate: {
            id: "c2",
            status: CertificateStatus.FAILED,
            generatedFilePath: null,
            generatedAt: null,
            isStale: true,
          },
        },
      ] as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const result = await publishBatch("batch-1", "key-1");
      expect(result.publishedCount).toBe(1);
      expect(result.ineligibleCount).toBe(1);

      // Verify eligible snapshot established
      expect(prisma.certificate.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: {
          publishedName: "Alice",
          publishedFilePath: "certificates/batch-1/p1/key-1.pdf",
        },
      });

      // Verify ineligible snapshot cleared
      expect(prisma.certificate.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["c2"] } },
        data: {
          publishedName: null,
          publishedFilePath: null,
        },
      });

      // Verify batch updated to PUBLISHED
      expect(prisma.certificateBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "batch-1",
            status: BatchStatus.GENERATED,
            publishedAt: null,
            currentGenerationKey: "key-1",
          }),
          data: expect.objectContaining({
            status: BatchStatus.PUBLISHED,
          }),
        })
      );
    });

    it("Guardrail #2: republish rebuilds snapshots and clears newly failed/stale certificates", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "key-2",
        templateId: "tpl-1",
      } as any);

      vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([
        {
          id: "p1",
          name: "Alice Updated",
          certificate: {
            id: "c1",
            status: CertificateStatus.GENERATED,
            generatedFilePath: "certificates/batch-1/p1/key-2.pdf",
            generatedAt: new Date(),
            isStale: false,
            publishedName: "Alice Old",
            publishedFilePath: "certificates/batch-1/p1/key-1.pdf",
          },
        },
        {
          id: "p2",
          name: "Bob",
          certificate: {
            id: "c2",
            status: CertificateStatus.FAILED, // Failed during regeneration!
            generatedFilePath: "certificates/batch-1/p2/key-1.pdf",
            generatedAt: new Date(),
            isStale: true,
            publishedName: "Bob Old",
            publishedFilePath: "certificates/batch-1/p2/key-1.pdf",
          },
        },
      ] as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const result = await publishBatch("batch-1", "key-2");
      expect(result.publishedCount).toBe(1);
      expect(result.ineligibleCount).toBe(1);

      // Eligible c1 updated to new name and file
      expect(prisma.certificate.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: {
          publishedName: "Alice Updated",
          publishedFilePath: "certificates/batch-1/p1/key-2.pdf",
        },
      });

      // Ineligible c2 must have old snapshot explicitly cleared!
      expect(prisma.certificate.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["c2"] } },
        data: {
          publishedName: null,
          publishedFilePath: null,
        },
      });
    });
  });

  describe("unpublishBatch", () => {
    it("rejects unauthorized caller", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
      await expect(unpublishBatch("batch-1")).rejects.toThrow(AdminAuthError);
    });

    it("unpublishes a PUBLISHED batch to GENERATED without deleting files", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
      } as any);

      const result = await unpublishBatch("batch-1");
      expect(result.unpublished).toBe(true);

      expect(prisma.certificateBatch.update).toHaveBeenCalledWith({
        where: { id: "batch-1" },
        data: {
          publishedAt: null,
          status: BatchStatus.GENERATED,
        },
      });
    });

    it("preserves operational status if batch was GENERATING when unpublished", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATING,
        publishedAt: new Date(),
      } as any);

      const result = await unpublishBatch("batch-1");
      expect(result.unpublished).toBe(true);

      expect(prisma.certificateBatch.update).toHaveBeenCalledWith({
        where: { id: "batch-1" },
        data: {
          publishedAt: null,
          status: BatchStatus.GENERATING,
        },
      });
    });

    it("is idempotent if batch is already unpublished", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATED,
        publishedAt: null,
      } as any);

      const result = await unpublishBatch("batch-1");
      expect(result.unpublished).toBe(true);
      expect(prisma.certificateBatch.update).not.toHaveBeenCalled();
    });
  });
});
