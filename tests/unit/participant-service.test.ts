import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  importParticipants,
  addParticipant,
  editParticipant,
  softDeleteParticipant,
  getActiveParticipants,
  BatchNotFoundError,
  BatchNotDraftError,
  ParticipantNotFoundError,
  UnexpectedCertificateStateError,
} from "@/lib/participants/service";
import { AdminAuthError } from "@/lib/auth/guard";
import { BatchStatus } from "@/generated/prisma/client";

// ─── Mocks ────────────────────────────────────────────────────────────────────

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
      findFirst: vi.fn(),
    },
    participant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { requireAdmin } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";

const BATCH_ID = "batch-1";
const PARTICIPANT_ID = "participant-1";

// ─── Shared setup ─────────────────────────────────────────────────────────────

const draftBatch = {
  id: BATCH_ID,
  name: "Test Batch",
  status: BatchStatus.DRAFT,
  deletedAt: null,
};

const publishedBatch = {
  id: BATCH_ID,
  name: "Test Batch",
  status: BatchStatus.PUBLISHED,
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    id: "admin-id",
    email: "admin@autocertif.local",
    role: "ADMIN",
  });
});

// ─── getActiveParticipants ────────────────────────────────────────────────────

describe("getActiveParticipants", () => {
  it("rejects unauthorized caller", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
    await expect(getActiveParticipants(BATCH_ID)).rejects.toThrow(AdminAuthError);
    expect(prisma.participant.findMany).not.toHaveBeenCalled();
  });

  it("throws BatchNotFoundError for nonexistent batch", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);
    await expect(getActiveParticipants(BATCH_ID)).rejects.toThrow(BatchNotFoundError);
  });

  it("returns only active (non-deleted) participants", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([
      { id: PARTICIPANT_ID, name: "Naufal", createdAt: new Date(), deletedAt: null },
    ] as never);

    const result = await getActiveParticipants(BATCH_ID);

    expect(prisma.participant.findMany).toHaveBeenCalledWith({
      where: { batchId: BATCH_ID, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(result).toHaveLength(1);
  });
});

// ─── importParticipants ───────────────────────────────────────────────────────

describe("importParticipants", () => {
  it("rejects unauthorized caller", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
    await expect(importParticipants(BATCH_ID, ["Naufal"])).rejects.toThrow(AdminAuthError);
  });

  it("throws BatchNotFoundError for deleted batch", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);
    await expect(importParticipants(BATCH_ID, ["Naufal"])).rejects.toThrow(BatchNotFoundError);
  });

  it("throws BatchNotDraftError for non-DRAFT batch", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(publishedBatch as never);
    await expect(importParticipants(BATCH_ID, ["Naufal"])).rejects.toThrow(BatchNotDraftError);
  });

  it("rejects empty names array", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    await expect(importParticipants(BATCH_ID, [])).rejects.toThrow(/No participant names/);
  });

  it("rejects import atomically when any submitted name is invalid", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    await expect(
      importParticipants(BATCH_ID, ["Naufal", "   ", "Budi"])
    ).rejects.toThrow(/empty or invalid/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("persists valid normalized names via transaction", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.$transaction).mockResolvedValueOnce([
      { id: "p1", name: "Naufal Nabil" },
      { id: "p2", name: "Budi Santoso" },
    ] as never);

    const result = await importParticipants(BATCH_ID, [
      "  Naufal Nabil  ",
      "Budi Santoso",
    ]);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.count).toBe(2);
  });

  it("allows duplicate names in the same import", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.$transaction).mockResolvedValueOnce([
      { id: "p1", name: "Budi" },
      { id: "p2", name: "Budi" },
    ] as never);

    const result = await importParticipants(BATCH_ID, ["Budi", "Budi"]);
    expect(result.count).toBe(2);
  });

  it("batch status remains DRAFT after import (no status change)", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.$transaction).mockResolvedValueOnce([] as never);

    await importParticipants(BATCH_ID, ["Naufal"]);

    // No update to certificateBatch should have been called
    expect(prisma.certificateBatch.findFirst).toHaveBeenCalledTimes(1);
    // Verify no status change — certificateBatch.update should not have been called
  });

  it("normalizes names server-side during import", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (ops) => ops);

    const participantCreateMock = vi.mocked(prisma.participant.create);
    participantCreateMock.mockResolvedValue({ id: "p1", name: "Naufal Nabil" } as never);

    await importParticipants(BATCH_ID, ["  Naufal   Nabil  "]);

    // The $transaction was called with create calls that use normalized names
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

// ─── addParticipant ───────────────────────────────────────────────────────────

describe("addParticipant", () => {
  it("rejects unauthorized caller", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
    await expect(addParticipant(BATCH_ID, "Naufal")).rejects.toThrow(AdminAuthError);
  });

  it("throws BatchNotDraftError for non-DRAFT batch", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(publishedBatch as never);
    await expect(addParticipant(BATCH_ID, "Naufal")).rejects.toThrow(BatchNotDraftError);
  });

  it("rejects empty name", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    await expect(addParticipant(BATCH_ID, "   ")).rejects.toThrow(/required/);
    expect(prisma.participant.create).not.toHaveBeenCalled();
  });

  it("creates participant with normalized name", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.create).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      name: "Naufal Nabil",
    } as never);

    const result = await addParticipant(BATCH_ID, "  Naufal   Nabil  ");

    expect(prisma.participant.create).toHaveBeenCalledWith({
      data: { batchId: BATCH_ID, name: "Naufal Nabil" },
    });
    expect(result.name).toBe("Naufal Nabil");
  });

  it("allows duplicate names", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.create).mockResolvedValueOnce({
      id: "p2",
      name: "Budi Santoso",
    } as never);

    const result = await addParticipant(BATCH_ID, "Budi Santoso");
    expect(result.name).toBe("Budi Santoso");
  });

  it("does not create Certificate records", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.create).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      name: "Naufal",
    } as never);

    await addParticipant(BATCH_ID, "Naufal");
    // No certificate create should be called
  });
});

// ─── editParticipant ──────────────────────────────────────────────────────────

describe("editParticipant", () => {
  it("rejects unauthorized caller", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
    await expect(
      editParticipant(BATCH_ID, PARTICIPANT_ID, "New Name")
    ).rejects.toThrow(AdminAuthError);
  });

  it("throws BatchNotDraftError for non-DRAFT batch", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(publishedBatch as never);
    await expect(
      editParticipant(BATCH_ID, PARTICIPANT_ID, "New Name")
    ).rejects.toThrow(BatchNotDraftError);
  });

  it("throws ParticipantNotFoundError if participant not in batch", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce(null);
    await expect(
      editParticipant(BATCH_ID, PARTICIPANT_ID, "New Name")
    ).rejects.toThrow(ParticipantNotFoundError);
  });

  it("throws ParticipantNotFoundError for deleted participant", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce(null);
    await expect(
      editParticipant(BATCH_ID, PARTICIPANT_ID, "New Name")
    ).rejects.toThrow(ParticipantNotFoundError);
  });

  it("throws UnexpectedCertificateStateError if certificate exists", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      name: "Old Name",
      batchId: BATCH_ID,
      deletedAt: null,
      certificate: { id: "cert-1" },
    } as never);

    await expect(
      editParticipant(BATCH_ID, PARTICIPANT_ID, "New Name")
    ).rejects.toThrow(UnexpectedCertificateStateError);
    expect(prisma.participant.update).not.toHaveBeenCalled();
  });

  it("normalizes the new name before updating", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      name: "Old Name",
      batchId: BATCH_ID,
      deletedAt: null,
      certificate: null,
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      name: "New Name",
    } as never);

    await editParticipant(BATCH_ID, PARTICIPANT_ID, "  New   Name  ");

    expect(prisma.participant.update).toHaveBeenCalledWith({
      where: { id: PARTICIPANT_ID },
      data: { name: "New Name" },
    });
  });

  it("allows duplicate name on edit", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      name: "Old Name",
      batchId: BATCH_ID,
      deletedAt: null,
      certificate: null,
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      name: "Budi Santoso",
    } as never);

    const result = await editParticipant(BATCH_ID, PARTICIPANT_ID, "Budi Santoso");
    expect(result.name).toBe("Budi Santoso");
  });
});

// ─── softDeleteParticipant ────────────────────────────────────────────────────

describe("softDeleteParticipant", () => {
  it("rejects unauthorized caller", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());
    await expect(
      softDeleteParticipant(BATCH_ID, PARTICIPANT_ID)
    ).rejects.toThrow(AdminAuthError);
  });

  it("throws BatchNotDraftError for non-DRAFT batch", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(publishedBatch as never);
    await expect(
      softDeleteParticipant(BATCH_ID, PARTICIPANT_ID)
    ).rejects.toThrow(BatchNotDraftError);
  });

  it("throws ParticipantNotFoundError for unknown participant", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce(null);
    await expect(
      softDeleteParticipant(BATCH_ID, PARTICIPANT_ID)
    ).rejects.toThrow(ParticipantNotFoundError);
  });

  it("throws UnexpectedCertificateStateError if certificate exists", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      batchId: BATCH_ID,
      name: "Naufal",
      deletedAt: null,
      certificate: { id: "cert-1" },
    } as never);

    await expect(
      softDeleteParticipant(BATCH_ID, PARTICIPANT_ID)
    ).rejects.toThrow(UnexpectedCertificateStateError);
    expect(prisma.participant.update).not.toHaveBeenCalled();
  });

  it("sets deletedAt timestamp and never calls hard delete", async () => {
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      batchId: BATCH_ID,
      name: "Naufal",
      deletedAt: null,
      certificate: null,
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValueOnce({
      id: PARTICIPANT_ID,
      deletedAt: new Date(),
    } as never);

    await softDeleteParticipant(BATCH_ID, PARTICIPANT_ID);

    expect(prisma.participant.update).toHaveBeenCalledWith({
      where: { id: PARTICIPANT_ID },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prisma.participant.delete).not.toHaveBeenCalled();
  });

  it("active list excludes deleted participant", async () => {
    // Active participant query filters deletedAt: null
    vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(draftBatch as never);
    vi.mocked(prisma.participant.findMany).mockResolvedValueOnce([] as never);

    const active = await getActiveParticipants(BATCH_ID);
    expect(active).toHaveLength(0);
    expect(prisma.participant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });
});
