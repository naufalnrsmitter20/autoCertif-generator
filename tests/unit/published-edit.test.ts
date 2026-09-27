/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  editPublishedParticipantName,
  retryPublishedReplacement,
} from "@/lib/publication/service";
import {
  BatchNotPublishedError,
  BatchNotEligibleForPublicationError,
  ConcurrentPublicationConflictError,
  InvalidParticipantNameError,
  PublishedParticipantMismatchError,
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

// Mock inngest
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: vi.fn(),
  },
}));

// Mock rendering prerequisites
vi.mock("@/lib/generation/preflight", () => ({
  validateRenderingPrerequisites: vi.fn(),
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
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    certificate: {
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(prismaMock)),
  };
  return { prisma: prismaMock };
});

import { requireAdmin } from "@/lib/auth/guard";
import { inngest } from "@/lib/inngest/client";
import { validateRenderingPrerequisites } from "@/lib/generation/preflight";
import { prisma } from "@/lib/prisma";

describe("Published Participant Edit & Retry Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      id: "admin-id",
      email: "admin@autocertif.local",
      role: "ADMIN",
    });
    vi.mocked(validateRenderingPrerequisites).mockResolvedValue({} as any);
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["event-1"] } as any);
  });

  describe("editPublishedParticipantName", () => {
    it("rejects unauthorized access", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
      await expect(
        editPublishedParticipantName("batch-1", "p-1", "New Name", "key-1")
      ).rejects.toThrow(AdminAuthError);
    });

    it("throws BatchNotFoundError if batch does not exist", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);
      await expect(
        editPublishedParticipantName("batch-1", "p-1", "New Name", "key-1")
      ).rejects.toThrow(BatchNotFoundError);
    });

    it("throws BatchNotPublishedError if batch has publishedAt == null", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "key-1",
      } as any);

      await expect(
        editPublishedParticipantName("batch-1", "p-1", "New Name", "key-1")
      ).rejects.toThrow(BatchNotPublishedError);
    });

    it("throws BatchNotEligibleForPublicationError if batch status is not PUBLISHED (e.g. GENERATING)", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATING,
        publishedAt: new Date(),
        currentGenerationKey: "key-1",
      } as any);

      await expect(
        editPublishedParticipantName("batch-1", "p-1", "New Name", "key-1")
      ).rejects.toThrow(BatchNotEligibleForPublicationError);
    });

    it("throws ConcurrentPublicationConflictError if batch generation key does not match CAS key", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        currentGenerationKey: "new-key",
      } as any);

      await expect(
        editPublishedParticipantName("batch-1", "p-1", "New Name", "stale-key")
      ).rejects.toThrow(ConcurrentPublicationConflictError);
    });

    it("rejects invalid, empty, or whitespace-only names", async () => {
      await expect(
        editPublishedParticipantName("batch-1", "p-1", "   ", "key-1")
      ).rejects.toThrow(InvalidParticipantNameError);

      await expect(
        editPublishedParticipantName("batch-1", "p-1", null, "key-1")
      ).rejects.toThrow(InvalidParticipantNameError);
    });

    it("rejects if participant is not found or has no certificate", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        currentGenerationKey: "key-1",
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce(null);

      await expect(
        editPublishedParticipantName("batch-1", "p-1", "New Name", "key-1")
      ).rejects.toThrow(PublishedParticipantMismatchError);
    });

    it("rejects if new name is identical to existing name", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        currentGenerationKey: "key-1",
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
        id: "p-1",
        name: "Alice Smith",
        certificate: {
          id: "cert-1",
          publishedName: "Alice Smith",
        },
      } as any);

      await expect(
        editPublishedParticipantName("batch-1", "p-1", "Alice Smith", "key-1")
      ).rejects.toThrow(InvalidParticipantNameError);
    });

    it("successfully initializes published replacement transactionally", async () => {
      const now = new Date();
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
        publishedAt: now,
        currentGenerationKey: "key-1",
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
        id: "p-1",
        name: "Alice Old",
        certificate: {
          id: "cert-1",
          status: CertificateStatus.GENERATED,
          publishedName: "Alice Old",
          publishedFilePath: "certs/batch-1/p-1/key-1.pdf",
          generatedFilePath: "certs/batch-1/p-1/key-1.pdf",
        },
      } as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.participant.update).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.certificate.update).mockResolvedValueOnce({} as any);

      const result = await editPublishedParticipantName(
        "batch-1",
        "p-1",
        "Alice New",
        "key-1"
      );

      expect(result.batchId).toBe("batch-1");
      expect(result.participantId).toBe("p-1");
      expect(result.newName).toBe("Alice New");
      expect(result.previousPublishedName).toBe("Alice Old");
      expect(result.generationKey).toBeDefined();

      // CAS batch update: PUBLISHED -> GENERATING, newGenerationKey
      expect(prisma.certificateBatch.updateMany).toHaveBeenCalledWith({
        where: {
          id: "batch-1",
          status: BatchStatus.PUBLISHED,
          currentGenerationKey: "key-1",
          deletedAt: null,
        },
        data: {
          status: BatchStatus.GENERATING,
          currentGenerationKey: result.generationKey,
        },
      });

      // Participant name updated to Alice New
      expect(prisma.participant.update).toHaveBeenCalledWith({
        where: { id: "p-1" },
        data: { name: "Alice New" },
      });

      // Certificate updated to PENDING, isStale = true, new generationKey
      // Crucially: publishedName and publishedFilePath are NOT touched
      expect(prisma.certificate.update).toHaveBeenCalledWith({
        where: { id: "cert-1" },
        data: {
          status: CertificateStatus.PENDING,
          generationKey: result.generationKey,
          generationError: null,
          isStale: true,
        },
      });

      // Inngest orchestrator event enqueued
      expect(inngest.send).toHaveBeenCalledWith({
        name: "autocertif/generation.batch.requested",
        id: `gen-batch-batch-1-${result.generationKey}`,
        data: {
          batchId: "batch-1",
          generationKey: result.generationKey,
        },
      });
    });

    it("throws ConcurrentPublicationConflictError if batch CAS fails during transaction", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        currentGenerationKey: "key-1",
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
        id: "p-1",
        name: "Alice Old",
        certificate: {
          id: "cert-1",
          status: CertificateStatus.GENERATED,
          publishedName: "Alice Old",
        },
      } as any);

      // CAS update count is 0
      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValueOnce({ count: 0 });

      await expect(
        editPublishedParticipantName("batch-1", "p-1", "Alice New", "key-1")
      ).rejects.toThrow(ConcurrentPublicationConflictError);
    });
  });

  describe("retryPublishedReplacement", () => {
    it("rejects unauthorized access", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
      await expect(
        retryPublishedReplacement("batch-1", "p-1", "key-1")
      ).rejects.toThrow(AdminAuthError);
    });

    it("rejects if batch is not published", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        currentGenerationKey: "key-1",
      } as any);

      await expect(
        retryPublishedReplacement("batch-1", "p-1", "key-1")
      ).rejects.toThrow(BatchNotPublishedError);
    });

    it("rejects if certificate is not FAILED", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        currentGenerationKey: "key-1",
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
        id: "p-1",
        name: "Alice Long Name",
        certificate: {
          id: "cert-1",
          status: CertificateStatus.GENERATED, // Not FAILED!
          publishedName: "Alice Old",
        },
      } as any);

      await expect(
        retryPublishedReplacement("batch-1", "p-1", "key-1")
      ).rejects.toThrow(BatchNotEligibleForPublicationError);
    });

    it("successfully retries failed replacement under fresh generationKey", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        currentGenerationKey: "key-1",
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
        id: "p-1",
        name: "Alice Long Name",
        certificate: {
          id: "cert-1",
          status: CertificateStatus.FAILED,
          isStale: true,
          publishedName: "Alice Old",
        },
      } as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.certificate.update).mockResolvedValueOnce({} as any);

      const result = await retryPublishedReplacement("batch-1", "p-1", "key-1");
      expect(result.participantId).toBe("p-1");
      expect(result.generationKey).toBeDefined();

      // Certificate set back to PENDING with fresh key and isStale = true
      expect(prisma.certificate.update).toHaveBeenCalledWith({
        where: { id: "cert-1" },
        data: {
          status: CertificateStatus.PENDING,
          generationKey: result.generationKey,
          generationError: null,
          isStale: true,
        },
      });

      // Inngest triggered
      expect(inngest.send).toHaveBeenCalledWith({
        name: "autocertif/generation.batch.requested",
        id: `gen-batch-batch-1-${result.generationKey}`,
        data: {
          batchId: "batch-1",
          generationKey: result.generationKey,
        },
      });
    });
  });
});
