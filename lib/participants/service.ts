import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { normalizeParticipantName } from "./normalize";
import { BatchStatus } from "@/generated/prisma/client";

// ─── Custom errors ────────────────────────────────────────────────────────────

export class ParticipantNotFoundError extends Error {
  constructor(message = "Participant not found or already deleted") {
    super(message);
    this.name = "ParticipantNotFoundError";
  }
}

export class BatchNotDraftError extends Error {
  constructor(
    message = "This operation is only allowed while the batch is in DRAFT status"
  ) {
    super(message);
    this.name = "BatchNotDraftError";
  }
}

export class BatchNotFoundError extends Error {
  constructor(message = "Batch not found or already deleted") {
    super(message);
    this.name = "BatchNotFoundError";
  }
}

export class UnexpectedCertificateStateError extends Error {
  constructor(
    message = "Participant has an existing certificate. Safe updates to participants with certificates require Phase 11 safe-update workflow."
  ) {
    super(message);
    this.name = "UnexpectedCertificateStateError";
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Load and verify an active DRAFT batch.
 * Throws BatchNotFoundError or BatchNotDraftError as appropriate.
 */
async function requireDraftBatch(batchId: string) {
  const batch = await prisma.certificateBatch.findFirst({
    where: { id: batchId, deletedAt: null },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.status !== BatchStatus.DRAFT) {
    throw new BatchNotDraftError();
  }

  return batch;
}

/**
 * Validate a single participant name server-side.
 * Normalizes and rejects empty/invalid values.
 * Returns normalized name string.
 */
function requireValidName(rawName: unknown): string {
  const normalized = normalizeParticipantName(rawName);
  if (normalized === null) {
    throw new Error(
      "Participant name is required and must not be empty after normalization."
    );
  }
  return normalized;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Return all active (non-deleted) participants for a DRAFT batch.
 * Ordered by createdAt asc then id asc for deterministic display.
 */
export async function getActiveParticipants(batchId: string) {
  await requireAdmin();

  const batch = await prisma.certificateBatch.findFirst({
    where: { id: batchId, deletedAt: null },
  });
  if (!batch) throw new BatchNotFoundError();

  return prisma.participant.findMany({
    where: { batchId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Bulk-import normalized participant names from CSV confirmation.
 *
 * Server contract:
 *  1. requireAdmin()
 *  2. Load active batch; verify deletedAt === null; verify status === DRAFT
 *  3. Validate every submitted name independently (normalize + reject empty)
 *  4. Reject the entire import if ANY submitted name is invalid (atomicity)
 *  5. Insert all valid names in a single bounded transaction
 *  6. No Certificate records are created
 *  7. Batch status remains DRAFT
 */
export async function importParticipants(
  batchId: string,
  rawNames: unknown[]
): Promise<{ count: number }> {
  await requireAdmin();
  await requireDraftBatch(batchId);

  if (!Array.isArray(rawNames) || rawNames.length === 0) {
    throw new Error("No participant names submitted for import.");
  }

  // Server-side re-validation of every submitted name
  const normalized: string[] = rawNames.map((raw, idx) => {
    const name = normalizeParticipantName(raw);
    if (name === null) {
      throw new Error(
        `Submitted name at index ${idx} is empty or invalid. Import rejected.`
      );
    }
    return name;
  });

  // Bulk insert in a single transaction
  const now = new Date();
  await prisma.$transaction(
    normalized.map((name) =>
      prisma.participant.create({
        data: {
          batchId,
          name,
          createdAt: now,
        },
      })
    )
  );

  return { count: normalized.length };
}

/**
 * Manually add a single participant to a DRAFT batch.
 *
 * Server contract:
 *  1. requireAdmin()
 *  2. Load active DRAFT batch
 *  3. Normalize + validate name
 *  4. Allow duplicate names
 *  5. Create Participant record
 *  6. No Certificate records created
 */
export async function addParticipant(
  batchId: string,
  rawName: unknown
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  await requireDraftBatch(batchId);

  const name = requireValidName(rawName);

  const participant = await prisma.participant.create({
    data: { batchId, name },
  });

  return { id: participant.id, name: participant.name };
}

/**
 * Edit an active participant's name in a DRAFT batch.
 *
 * Phase 6 safety boundary:
 *  - Only allowed while batch is DRAFT.
 *  - If an existing Certificate record unexpectedly exists for the participant,
 *    the mutation is stopped and UnexpectedCertificateStateError is thrown.
 *    (Phase 11 owns the published-edit safe-update workflow.)
 *
 * Server contract:
 *  1. requireAdmin()
 *  2. Load active DRAFT batch
 *  3. Verify participant belongs to that batch and is not soft-deleted
 *  4. Guard against unexpected Certificate records (Phase 11 dependency)
 *  5. Normalize + validate new name
 *  6. Allow duplicate names
 *  7. Update participant name only
 */
export async function editParticipant(
  batchId: string,
  participantId: string,
  rawName: unknown
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  await requireDraftBatch(batchId);

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, batchId, deletedAt: null },
    include: { certificate: true },
  });

  if (!participant) {
    throw new ParticipantNotFoundError();
  }

  // Phase 11 guard: safe-update workflow not yet implemented
  if (participant.certificate !== null) {
    throw new UnexpectedCertificateStateError();
  }

  const name = requireValidName(rawName);

  const updated = await prisma.participant.update({
    where: { id: participantId },
    data: { name },
  });

  return { id: updated.id, name: updated.name };
}

/**
 * Soft-delete a participant from a DRAFT batch.
 *
 * Never issues a physical DELETE. Sets deletedAt to current timestamp.
 *
 * Phase 6 safety boundary:
 *  - Only allowed while batch is DRAFT.
 *  - If an unexpected Certificate record exists, stops safely.
 *
 * Server contract:
 *  1. requireAdmin()
 *  2. Load active DRAFT batch
 *  3. Verify participant belongs to batch and is not already deleted
 *  4. Guard against unexpected Certificate records (Phase 11 dependency)
 *  5. Set deletedAt = now
 */
export async function softDeleteParticipant(
  batchId: string,
  participantId: string
): Promise<void> {
  await requireAdmin();
  await requireDraftBatch(batchId);

  const participant = await prisma.participant.findFirst({
    where: { id: participantId, batchId, deletedAt: null },
    include: { certificate: true },
  });

  if (!participant) {
    throw new ParticipantNotFoundError();
  }

  // Phase 11 guard
  if (participant.certificate !== null) {
    throw new UnexpectedCertificateStateError();
  }

  await prisma.participant.update({
    where: { id: participantId },
    data: { deletedAt: new Date() },
  });
}
