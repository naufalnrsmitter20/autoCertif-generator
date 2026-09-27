/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";
import {
  getBatchGenerationManagementData,
  retryParticipantGeneration,
  regenerateParticipantGeneration,
  regenerateBatchGeneration,
  recoverFailedBatchGeneration,
} from "@/lib/generation/management";
import * as preflightModule from "@/lib/generation/preflight";
import {
  BatchNotEligibleForGenerationError,
  ConcurrentGenerationConflictError,
} from "@/lib/generation/errors";
import { BatchNotFoundError } from "@/lib/batches";

vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com", role: "ADMIN" }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    certificateBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    participant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    certificate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({ ids: ["event-1"] }),
  },
}));

describe("Phase 10 — Generation Management Domain Service", () => {
  const batchId = "batch-100";
  const participantId1 = "part-1";
  const participantId2 = "part-2";
  const certId1 = "cert-1";
  const certId2 = "cert-2";
  const currentKey = "gen-key-current";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(preflightModule, "validateRenderingPrerequisites").mockResolvedValue({
      batchId,
      batchName: "Test Batch",
      templateId: "tpl-1",
      templateUpdatedAt: new Date(),
      templateFileType: "PDF" as any,
      templateSourceFilePath: "templates/test.pdf",
      namePlacement: { xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.5, alignment: "center" },
      fontConfig: { fontSize: 24, minFontSize: 12, lineHeightMultiplier: 1.2, textColor: { r: 0, g: 0, b: 0 } },
      fontAssetPath: "test-font",
      activeParticipants: [{ id: participantId1, name: "Budi Santoso", normalizedName: "Budi Santoso" }],
    });

    // Default $transaction implementation executes the callback with mock prisma
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      return cb(prisma);
    });
  });

  describe("getBatchGenerationManagementData", () => {
    it("returns summary counts and client-safe participant rows, rejecting nonexistent batch", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);
      await expect(getBatchGenerationManagementData(batchId)).rejects.toThrow(BatchNotFoundError);

      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: batchId,
        name: "Test Batch",
        status: BatchStatus.GENERATED,
        currentGenerationKey: currentKey,
        updatedAt: new Date("2026-09-27T00:00:00Z"),
      } as any);

      vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([
        {
          id: participantId1,
          name: "Ahmad Dahlan",
          certificate: {
            id: certId1,
            status: CertificateStatus.GENERATED,
            generationError: null,
            generatedAt: new Date("2026-09-27T00:01:00Z"),
            generatedFilePath: "certificates/batch-100/part-1/key.pdf",
            isStale: false,
          },
        },
        {
          id: participantId2,
          name: "Siti Rahma",
          certificate: {
            id: certId2,
            status: CertificateStatus.FAILED,
            generationError: "NAME_DOES_NOT_FIT: SINGLE_WORD_OVERFLOW",
            generatedAt: new Date("2026-09-26T23:59:00Z"),
            generatedFilePath: "certificates/batch-100/part-2/old-key.pdf",
            isStale: true,
          },
        },
      ] as any);

      const result = await getBatchGenerationManagementData(batchId);

      expect(result.batch.id).toBe(batchId);
      expect(result.summary.total).toBe(2);
      expect(result.summary.generated).toBe(1);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.stale).toBe(1);
      expect(result.participants).toHaveLength(2);
      expect(result.participants[0].hasPreviousOutput).toBe(true);
      expect(result.participants[0].isStale).toBe(false);
      expect(result.participants[1].hasPreviousOutput).toBe(true);
      expect(result.participants[1].isStale).toBe(true);
      expect(result.participants[1].safeGenerationError).toBe("NAME_DOES_NOT_FIT: SINGLE_WORD_OVERFLOW");

      // Verify no storage paths leaked in participant rows
      expect((result.participants[0] as any).generatedFilePath).toBeUndefined();
      expect((result.participants[1] as any).generatedFilePath).toBeUndefined();
    });
  });

  describe("Action Contract Precondition Tests", () => {
    it("rejects retry on GENERATED Certificate", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: currentKey,
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValue({
        id: participantId1,
        batchId,
        certificate: {
          id: certId1,
          status: CertificateStatus.GENERATED, // Invalid: retry requires FAILED
        },
      } as any);

      await expect(
        retryParticipantGeneration(batchId, participantId1, currentKey)
      ).rejects.toThrow(BatchNotEligibleForGenerationError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects regenerate on FAILED Certificate", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: currentKey,
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValue({
        id: participantId1,
        batchId,
        certificate: {
          id: certId1,
          status: CertificateStatus.FAILED, // Invalid: regenerate requires GENERATED
        },
      } as any);

      await expect(
        regenerateParticipantGeneration(batchId, participantId1, currentKey)
      ).rejects.toThrow(BatchNotEligibleForGenerationError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects participant retry/regenerate when batch is FAILED", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.FAILED, // Invalid: participant operations require GENERATED
        currentGenerationKey: currentKey,
      } as any);

      await expect(
        retryParticipantGeneration(batchId, participantId1, currentKey)
      ).rejects.toThrow(BatchNotEligibleForGenerationError);

      await expect(
        regenerateParticipantGeneration(batchId, participantId1, currentKey)
      ).rejects.toThrow(BatchNotEligibleForGenerationError);
    });

    it("rejects batch regeneration while batch is GENERATING", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATING, // Invalid: requires GENERATED
        currentGenerationKey: currentKey,
      } as any);

      await expect(
        regenerateBatchGeneration(batchId, currentKey)
      ).rejects.toThrow(BatchNotEligibleForGenerationError);
    });

    it("rejects action when expectedCurrentGenerationKey is stale (optimistic concurrency conflict)", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: "NEWER-KEY-123", // Does not match expectedKey
      } as any);

      await expect(
        retryParticipantGeneration(batchId, participantId1, "OLD-KEY-ABC")
      ).rejects.toThrow(ConcurrentGenerationConflictError);

      await expect(
        regenerateParticipantGeneration(batchId, participantId1, "OLD-KEY-ABC")
      ).rejects.toThrow(ConcurrentGenerationConflictError);

      await expect(
        regenerateBatchGeneration(batchId, "OLD-KEY-ABC")
      ).rejects.toThrow(ConcurrentGenerationConflictError);

      // Verify zero mutation occurred
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(inngest.send).not.toHaveBeenCalled();
    });
  });

  describe("Individual Retry & Regeneration Execution", () => {
    it("retryParticipantGeneration: transitions only target cert to PENDING, preserves previous output, and enqueues event", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: currentKey,
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValue({
        id: participantId1,
        batchId,
        certificate: {
          id: certId1,
          status: CertificateStatus.FAILED,
          generatedFilePath: "certificates/batch-100/part-1/prev.pdf",
        },
      } as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.certificate.findFirst).mockResolvedValue({
        id: certId1,
        status: CertificateStatus.FAILED,
        generatedFilePath: "certificates/batch-100/part-1/prev.pdf",
      } as any);

      const result = await retryParticipantGeneration(batchId, participantId1, currentKey);

      expect(result.certificateId).toBe(certId1);
      expect(result.generationKey).toBeDefined();

      // Batch CAS update
      expect(prisma.certificateBatch.updateMany).toHaveBeenCalledWith({
        where: {
          id: batchId,
          status: BatchStatus.GENERATED,
          currentGenerationKey: currentKey,
          deletedAt: null,
        },
        data: {
          status: BatchStatus.GENERATING,
          currentGenerationKey: result.generationKey,
        },
      });

      // Target certificate updated to PENDING, generationError cleared, isStale set true
      expect(prisma.certificate.update).toHaveBeenCalledWith({
        where: { id: certId1 },
        data: {
          status: CertificateStatus.PENDING,
          generationKey: result.generationKey,
          generationError: null,
          isStale: true,
        },
      });

      // Inngest event enqueued
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "autocertif/generation.batch.requested",
          data: { batchId, generationKey: result.generationKey },
        })
      );
    });

    it("regenerateParticipantGeneration: transitions only target cert to PENDING, preserves previous output with isStale=true", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: currentKey,
      } as any);

      vi.mocked(prisma.participant.findFirst).mockResolvedValue({
        id: participantId1,
        batchId,
        certificate: {
          id: certId1,
          status: CertificateStatus.GENERATED,
          generatedFilePath: "certificates/batch-100/part-1/valid.pdf",
        },
      } as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.certificate.findFirst).mockResolvedValue({
        id: certId1,
        status: CertificateStatus.GENERATED,
        generatedFilePath: "certificates/batch-100/part-1/valid.pdf",
      } as any);

      const result = await regenerateParticipantGeneration(batchId, participantId1, currentKey);

      expect(result.certificateId).toBe(certId1);
      expect(result.generationKey).toBeDefined();

      expect(prisma.certificate.update).toHaveBeenCalledWith({
        where: { id: certId1 },
        data: {
          status: CertificateStatus.PENDING,
          generationKey: result.generationKey,
          generationError: null,
          isStale: true,
        },
      });
    });
  });

  describe("Whole-Batch Regeneration Execution", () => {
    it("regenerateBatchGeneration: resets all active certificates to PENDING with fresh key and preserves existing outputs", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.GENERATED,
        currentGenerationKey: currentKey,
      } as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.certificate.findMany).mockResolvedValue([
        { id: certId1, generatedFilePath: "path/1.pdf" },
        { id: certId2, generatedFilePath: null },
      ] as any);

      const result = await regenerateBatchGeneration(batchId, currentKey);

      expect(result.participantCount).toBe(1);
      expect(result.generationKey).toBeDefined();

      expect(prisma.certificate.update).toHaveBeenCalledWith({
        where: { id: certId1 },
        data: {
          status: CertificateStatus.PENDING,
          generationKey: result.generationKey,
          generationError: null,
          isStale: true, // Had previous file
        },
      });

      expect(prisma.certificate.update).toHaveBeenCalledWith({
        where: { id: certId2 },
        data: {
          status: CertificateStatus.PENDING,
          generationKey: result.generationKey,
          generationError: null,
          isStale: false, // Did not have previous file
        },
      });
    });
  });

  describe("FAILED Batch Recovery Scope (User Correction 1 & 5)", () => {
    const failedKey = "failed-operation-key";

    it("Test A: failed INDIVIDUAL regeneration recovers only that 1 target participant", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.FAILED,
        currentGenerationKey: failedKey,
      } as any);

      // Only certId1 belonged to the failed operation and was left in GENERATING
      vi.mocked(prisma.certificate.findMany).mockResolvedValue([
        {
          id: certId1,
          participantId: participantId1,
          generationKey: failedKey,
          status: CertificateStatus.GENERATING,
          generatedFilePath: "path/old.pdf",
        },
      ] as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 1 });

      const result = await recoverFailedBatchGeneration(batchId, failedKey);

      expect(result.reconciled).toBe(false);
      if (!result.reconciled) {
        expect(result.recoveredCount).toBe(1);
        expect(result.generationKey).toBeDefined();
        expect(result.generationKey).not.toBe(failedKey);

        // Only certId1 was updated! certId2 was never queried or updated
        expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
        expect(prisma.certificate.update).toHaveBeenCalledWith({
          where: { id: certId1 },
          data: {
            status: CertificateStatus.PENDING,
            generationKey: result.generationKey,
            generationError: null,
            isStale: true,
          },
        });
      }
    });

    it("Test B: failed WHOLE-BATCH operation recovers only unfinished certificates from failed operation", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.FAILED,
        currentGenerationKey: failedKey,
      } as any);

      // Suppose out of 2 certificates in the whole batch attempt, certId1 was already GENERATED
      // and only certId2 was still in PENDING when orchestrator crashed
      vi.mocked(prisma.certificate.findMany).mockResolvedValue([
        {
          id: certId2,
          participantId: participantId2,
          generationKey: failedKey,
          status: CertificateStatus.PENDING,
          generatedFilePath: null,
        },
      ] as any);

      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 1 });

      const result = await recoverFailedBatchGeneration(batchId, failedKey);

      expect(result.reconciled).toBe(false);
      if (!result.reconciled) {
        expect(result.recoveredCount).toBe(1);
        // Only certId2 was reset to PENDING, certId1 (already GENERATED) was NOT touched
        expect(prisma.certificate.update).toHaveBeenCalledTimes(1);
        expect(prisma.certificate.update).toHaveBeenCalledWith({
          where: { id: certId2 },
          data: {
            status: CertificateStatus.PENDING,
            generationKey: result.generationKey,
            generationError: null,
            isStale: false,
          },
        });
      }
    });

    it("reconciles safely when 0 unfinished certificates remain for failed operation", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.FAILED,
        currentGenerationKey: failedKey,
      } as any);

      // All certificates had reached terminal state
      vi.mocked(prisma.certificate.findMany).mockResolvedValue([]);
      vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 1 });

      const result = await recoverFailedBatchGeneration(batchId, failedKey);

      expect(result.reconciled).toBe(true);
      expect(result.recoveredCount).toBe(0);

      // Transitions directly to GENERATED without fan-out
      expect(prisma.certificateBatch.updateMany).toHaveBeenCalledWith({
        where: {
          id: batchId,
          status: BatchStatus.FAILED,
          currentGenerationKey: failedKey,
          deletedAt: null,
        },
        data: {
          status: BatchStatus.GENERATED,
        },
      });
      expect(inngest.send).not.toHaveBeenCalled();
    });

    it("Test C: stale recovery request rejects with conflict and zero DB mutation", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
        id: batchId,
        status: BatchStatus.FAILED,
        currentGenerationKey: "RECOVERED-KEY-789", // Already recovered with new key
      } as any);

      await expect(
        recoverFailedBatchGeneration(batchId, "STALE-FAILED-KEY")
      ).rejects.toThrow(ConcurrentGenerationConflictError);

      expect(prisma.certificateBatch.updateMany).not.toHaveBeenCalled();
      expect(prisma.certificate.update).not.toHaveBeenCalled();
      expect(inngest.send).not.toHaveBeenCalled();
    });
  });
});
