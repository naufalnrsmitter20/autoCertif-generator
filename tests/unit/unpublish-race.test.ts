/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { unpublishBatch, publishBatch } from "@/lib/publication/service";
import { checkAndFinalizeBatch } from "@/lib/generation/finalization";
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

// Mock storage
vi.mock("@/lib/storage/supabase-storage", () => ({
  uploadGeneratedCertificate: vi.fn(),
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
      count: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(prismaMock)),
  };
  return { prisma: prismaMock };
});

import { requireAdmin } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";

describe("Guardrail #3: Unpublish vs Replacement Race", () => {
  const batchId = "batch-race-1";
  const participantId = "p-1";
  const certId = "cert-1";
  const oldGenKey = "old-gen-key";
  const replacementGenKey = "replacement-gen-key";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      id: "admin-id",
      email: "admin@autocertif.local",
      role: "ADMIN",
    });
  });

  it("handles replacement starts -> ADMIN unpublishes -> worker succeeds -> batch remains unpublished", async () => {
    // Stage 1: Batch was PUBLISHED, but replacement started
    // Batch is currently GENERATING under replacementGenKey, publishedAt is still non-null
    const publishedAt = new Date("2026-09-27T00:00:00Z");

    // Stage 2: ADMIN unpublishes while generation is in progress
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
      id: batchId,
      status: BatchStatus.GENERATING,
      publishedAt: publishedAt,
    } as any);

    const unpublishResult = await unpublishBatch(batchId);
    expect(unpublishResult.unpublished).toBe(true);

    // Unpublish updated batch: publishedAt -> null, status remains GENERATING
    expect(prisma.certificateBatch.update).toHaveBeenCalledWith({
      where: { id: batchId },
      data: {
        publishedAt: null,
        status: BatchStatus.GENERATING,
      },
    });

    // Stage 3: Worker finishes generation and runs finalize-certificate-record
    // Simulate what generate-participant does when batch is now unpublished:
    // It queries the batch to check if published:
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
      id: batchId,
      publishedAt: null, // ADMIN already unpublished!
    } as any);

    // Worker checks isPublished -> false
    const batchAfterUnpublish = await prisma.certificateBatch.findFirst({
      where: { id: batchId, deletedAt: null },
      select: { publishedAt: true },
    });
    const isPublished = batchAfterUnpublish?.publishedAt !== null;
    expect(isPublished).toBe(false);

    // Worker updates certificate record
    const newStoragePath = `certificates/${batchId}/${participantId}/${replacementGenKey}.pdf`;
    const generatedAt = new Date();

    const certUpdateData: any = {
      status: CertificateStatus.GENERATED,
      generatedFilePath: newStoragePath,
      generatedAt,
      generationError: null,
      isStale: false,
    };
    if (isPublished) {
      certUpdateData.publishedFilePath = newStoragePath;
      certUpdateData.publishedName = "Alice New";
    }

    // Notice: publishedFilePath and publishedName are NOT in certUpdateData!
    expect(certUpdateData.publishedFilePath).toBeUndefined();
    expect(certUpdateData.publishedName).toBeUndefined();
    expect(certUpdateData.isStale).toBe(false);
    expect(certUpdateData.generatedFilePath).toBe(newStoragePath);

    await prisma.certificate.updateMany({
      where: {
        id: certId,
        batchId,
        generationKey: replacementGenKey,
        status: CertificateStatus.GENERATING,
        deletedAt: null,
      },
      data: certUpdateData,
    });

    expect(prisma.certificate.updateMany).toHaveBeenCalledWith({
      where: {
        id: certId,
        batchId,
        generationKey: replacementGenKey,
        status: CertificateStatus.GENERATING,
        deletedAt: null,
      },
      data: expect.objectContaining({
        status: CertificateStatus.GENERATED,
        generatedFilePath: newStoragePath,
        isStale: false,
      }),
    });

    // Stage 4: Worker calls checkAndFinalizeBatch
    // checkAndFinalizeBatch finds batch with publishedAt == null
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
      id: batchId,
      status: BatchStatus.GENERATING,
      currentGenerationKey: replacementGenKey,
      publishedAt: null, // UNPUBLISHED
    } as any);

    // All certificates are terminal (count of unfinished = 0)
    vi.mocked(prisma.certificate.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValueOnce({ count: 1 });

    const finalizationResult = await checkAndFinalizeBatch(batchId, replacementGenKey);
    expect(finalizationResult.finalized).toBe(true);

    // checkAndFinalizeBatch finalizes to GENERATED (NOT PUBLISHED!)
    expect(prisma.certificateBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: batchId,
        status: BatchStatus.GENERATING,
        currentGenerationKey: replacementGenKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATED, // Remains unpublished!
      },
    });

    // Stage 5: Future republish rebuilds publication snapshots from current eligibility
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
      id: batchId,
      status: BatchStatus.GENERATED,
      publishedAt: null,
      currentGenerationKey: replacementGenKey,
      templateId: "tpl-1",
    } as any);

    vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([
      {
        id: participantId,
        name: "Alice New",
        certificate: {
          id: certId,
          status: CertificateStatus.GENERATED,
          generatedFilePath: newStoragePath,
          generatedAt,
          isStale: false,
          publishedName: "Alice Old", // Old snapshot from before
          publishedFilePath: `certificates/${batchId}/${participantId}/${oldGenKey}.pdf`,
        },
      },
    ] as any);

    vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValueOnce({ count: 1 });

    const republishResult = await publishBatch(batchId, replacementGenKey);
    expect(republishResult.publishedCount).toBe(1);
    expect(republishResult.ineligibleCount).toBe(0);

    // Republish rebuilds snapshot with current participant name and replacement path
    expect(prisma.certificate.update).toHaveBeenCalledWith({
      where: { id: certId },
      data: {
        publishedName: "Alice New",
        publishedFilePath: newStoragePath,
      },
    });
  });
});
