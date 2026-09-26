/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAndFinalizeBatch } from "@/lib/generation/finalization";
import { prisma } from "@/lib/prisma";
import { BatchStatus } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    certificateBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    certificate: {
      count: vi.fn(),
    },
  },
}));

describe("checkAndFinalizeBatch Race-Safe Finalization Helper", () => {
  const batchId = "batch-123";
  const generationKey = "gen-uuid-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns batch_not_found when batch does not exist", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue(null);

    const result = await checkAndFinalizeBatch(batchId, generationKey);
    expect(result).toEqual({ finalized: false, reason: "batch_not_found" });
    expect(prisma.certificateBatch.updateMany).not.toHaveBeenCalled();
  });

  it("returns stale_attempt and no-ops when batch currentGenerationKey differs", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.GENERATING,
      currentGenerationKey: "newer-generation-key",
    } as any);

    const result = await checkAndFinalizeBatch(batchId, generationKey);
    expect(result).toEqual({ finalized: false, reason: "stale_attempt" });
    expect(prisma.certificate.count).not.toHaveBeenCalled();
    expect(prisma.certificateBatch.updateMany).not.toHaveBeenCalled();
  });

  it("returns already_finalized when batch is not in GENERATING status", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.GENERATED,
      currentGenerationKey: generationKey,
    } as any);

    const result = await checkAndFinalizeBatch(batchId, generationKey);
    expect(result).toEqual({ finalized: false, reason: "already_finalized" });
    expect(prisma.certificate.count).not.toHaveBeenCalled();
    expect(prisma.certificateBatch.updateMany).not.toHaveBeenCalled();
  });

  it("returns still_pending and leaves batch GENERATING when unfinished certificates exist", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.GENERATING,
      currentGenerationKey: generationKey,
    } as any);

    vi.mocked(prisma.certificate.count).mockResolvedValue(3);

    const result = await checkAndFinalizeBatch(batchId, generationKey);
    expect(result).toEqual({
      finalized: false,
      reason: "still_pending",
      pendingCount: 3,
    });
    expect(prisma.certificateBatch.updateMany).not.toHaveBeenCalled();
  });

  it("finalizes batch to GENERATED when all certificates are terminal (mixed success/fail)", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.GENERATING,
      currentGenerationKey: generationKey,
    } as any);

    // 0 unfinished certificates (all reached terminal GENERATED or FAILED)
    vi.mocked(prisma.certificate.count).mockResolvedValue(0);
    vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 1 });

    const result = await checkAndFinalizeBatch(batchId, generationKey);
    expect(result).toEqual({
      finalized: true,
      reason: "finalized",
      pendingCount: 0,
    });

    expect(prisma.certificateBatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: batchId,
        status: BatchStatus.GENERATING,
        currentGenerationKey: generationKey,
        deletedAt: null,
      },
      data: {
        status: BatchStatus.GENERATED,
      },
    });
  });

  it("finalizes batch to GENERATED even when 100% of participants failed (Correction #9)", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.GENERATING,
      currentGenerationKey: generationKey,
    } as any);

    // 0 pending/generating means all are terminal (even if all FAILED)
    vi.mocked(prisma.certificate.count).mockResolvedValue(0);
    vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 1 });

    const result = await checkAndFinalizeBatch(batchId, generationKey);
    expect(result.finalized).toBe(true);
    expect(result.reason).toBe("finalized");
  });

  it("handles race condition where concurrent worker already finalized the batch", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValue({
      id: batchId,
      status: BatchStatus.GENERATING,
      currentGenerationKey: generationKey,
    } as any);

    vi.mocked(prisma.certificate.count).mockResolvedValue(0);
    // Concurrent worker updated it first, so updateMany matches 0 rows
    vi.mocked(prisma.certificateBatch.updateMany).mockResolvedValue({ count: 0 });

    const result = await checkAndFinalizeBatch(batchId, generationKey);
    expect(result.finalized).toBe(false);
    expect(result.reason).toBe("already_finalized");
  });
});
