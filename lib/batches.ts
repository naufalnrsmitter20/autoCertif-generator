import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { batchInputSchema } from "@/lib/validations/batch";
import { BatchStatus } from "@/generated/prisma/client";
import { withPrismaConnectionRetry } from "@/lib/db-retry";

export class BatchNotFoundError extends Error {
  constructor(message = "Certificate batch not found or already deleted") {
    super(message);
    this.name = "BatchNotFoundError";
  }
}

/**
 * Fetch all active certificate batches.
 * Excludes soft-deleted records (deletedAt IS NULL).
 * Ordered by creation date descending (newest first).
 */
export async function getActiveBatches() {
  await requireAdmin();

  return withPrismaConnectionRetry(() => prisma.certificateBatch.findMany({
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
  }));
}

/**
 * Fetch an active certificate batch by ID.
 * Returns null if record does not exist or has been soft-deleted.
 */
export async function getActiveBatchById(id: string) {
  await requireAdmin();

  return withPrismaConnectionRetry(() => prisma.certificateBatch.findFirst({
    where: {
      id,
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
  }));
}

/**
 * Create a new CertificateBatch.
 * Default status is always DRAFT.
 * Does not accept template, publishedAt, or deletedAt from client input.
 */
export async function createBatch(input: { name: string }) {
  await requireAdmin();

  const validated = batchInputSchema.parse(input);

  return prisma.certificateBatch.create({
    data: {
      name: validated.name,
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
}

/**
 * Update the name of an active certificate batch.
 * Only modifies the batch name; does not alter lifecycle status.
 * Rejects nonexistent or soft-deleted batches.
 */
export async function updateBatchName(id: string, input: { name: string }) {
  await requireAdmin();

  const validated = batchInputSchema.parse(input);

  const existing = await prisma.certificateBatch.findFirst({
    where: {
      id,
      deletedAt: null,
    },
  });

  if (!existing) {
    throw new BatchNotFoundError();
  }

  return prisma.certificateBatch.update({
    where: { id },
    data: {
      name: validated.name,
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
}

/**
 * Soft-delete a certificate batch by recording the deletedAt timestamp.
 * Preserves relational integrity; never issues a physical DELETE query.
 * Rejects nonexistent or already soft-deleted batches.
 */
export async function softDeleteBatch(id: string) {
  await requireAdmin();

  const existing = await prisma.certificateBatch.findFirst({
    where: {
      id,
      deletedAt: null,
    },
  });

  if (!existing) {
    throw new BatchNotFoundError();
  }

  return prisma.certificateBatch.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
}

export interface BatchGenerationSummary {
  total: number;
  pending: number;
  generating: number;
  generated: number;
  failed: number;
}

/**
 * Fetch certificate generation summary counts for an active batch.
 */
export async function getBatchGenerationSummary(
  batchId: string
): Promise<BatchGenerationSummary> {
  await requireAdmin();

  const counts = await prisma.certificate.groupBy({
    by: ["status"],
    where: {
      batchId,
      deletedAt: null,
    },
    _count: {
      _all: true,
    },
  });

  const summary: BatchGenerationSummary = {
    total: 0,
    pending: 0,
    generating: 0,
    generated: 0,
    failed: 0,
  };

  for (const item of counts) {
    const count = item._count._all;
    summary.total += count;
    switch (item.status) {
      case "PENDING":
        summary.pending = count;
        break;
      case "GENERATING":
        summary.generating = count;
        break;
      case "GENERATED":
        summary.generated = count;
        break;
      case "FAILED":
        summary.failed = count;
        break;
    }
  }

  return summary;
}
