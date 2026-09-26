import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  updateTemplatePlacement,
  TemplateEligibilityError,
  StaleTemplateConflictError,
} from "@/lib/templates";
import { AdminAuthError } from "@/lib/auth/guard";
import { BatchNotFoundError } from "@/lib/batches";
import { BatchStatus } from "@/generated/prisma/client";
import { NamePlacement, DEFAULT_NAME_PLACEMENT } from "@/lib/coordinates";

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

// Mock storage server to prevent server-only import in vitest
vi.mock("@/lib/storage/server", () => ({
  createTemplateSignedUploadUrl: vi.fn(),
  downloadTemplateBuffer: vi.fn(),
  deleteTemplateObject: vi.fn(),
  createTemplateSignedReadUrl: vi.fn(),
}));

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    certificateBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    certificateTemplate: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn((cb) =>
      cb({
        certificateBatch: {
          findFirst: vi.fn(),
          updateMany: vi.fn(),
        },
        certificateTemplate: {
          updateMany: vi.fn(),
        },
      })
    ),
  },
}));

import { requireAdmin } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";

type MockTxCallback = (tx: {
  certificateBatch: {
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  certificateTemplate: {
    updateMany: ReturnType<typeof vi.fn>;
  };
}) => Promise<unknown>;

describe("lib/templates - updateTemplatePlacement", () => {
  const mockBatchId = "batch_123";
  const mockTemplateId = "tmpl_abc";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin_1", email: "admin@test.local", role: "ADMIN" });
  });

  it("throws AdminAuthError when unauthenticated", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());

    await expect(
      updateTemplatePlacement(mockBatchId, {
        templateId: mockTemplateId,
        placement: DEFAULT_NAME_PLACEMENT,
      })
    ).rejects.toThrow(AdminAuthError);
  });

  it("throws BatchNotFoundError when active batch does not exist", async () => {
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
      const typedCb = cb as unknown as MockTxCallback;
      return typedCb({
        certificateBatch: {
          findFirst: vi.fn().mockResolvedValue(null),
          updateMany: vi.fn(),
        },
        certificateTemplate: {
          updateMany: vi.fn(),
        },
      });
    });

    await expect(
      updateTemplatePlacement(mockBatchId, {
        templateId: mockTemplateId,
        placement: DEFAULT_NAME_PLACEMENT,
      })
    ).rejects.toThrow(BatchNotFoundError);
  });

  it("throws TemplateEligibilityError when batch is not in DRAFT status", async () => {
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
      const typedCb = cb as unknown as MockTxCallback;
      return typedCb({
        certificateBatch: {
          findFirst: vi.fn().mockResolvedValue({
            id: mockBatchId,
            status: BatchStatus.READY,
            templateId: mockTemplateId,
          }),
          updateMany: vi.fn(),
        },
        certificateTemplate: {
          updateMany: vi.fn(),
        },
      });
    });

    await expect(
      updateTemplatePlacement(mockBatchId, {
        templateId: mockTemplateId,
        placement: DEFAULT_NAME_PLACEMENT,
      })
    ).rejects.toThrow(TemplateEligibilityError);
  });

  it("throws StaleTemplateConflictError when batch.templateId does not match submittedTemplateId", async () => {
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
      const typedCb = cb as unknown as MockTxCallback;
      return typedCb({
        certificateBatch: {
          findFirst: vi.fn().mockResolvedValue({
            id: mockBatchId,
            status: BatchStatus.DRAFT,
            templateId: "tmpl_different",
          }),
          updateMany: vi.fn(),
        },
        certificateTemplate: {
          updateMany: vi.fn(),
        },
      });
    });

    await expect(
      updateTemplatePlacement(mockBatchId, {
        templateId: mockTemplateId,
        placement: DEFAULT_NAME_PLACEMENT,
      })
    ).rejects.toThrow(StaleTemplateConflictError);
  });

  it("throws StaleTemplateConflictError when atomic update affects 0 rows", async () => {
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
      const typedCb = cb as unknown as MockTxCallback;
      return typedCb({
        certificateBatch: {
          findFirst: vi.fn().mockResolvedValue({
            id: mockBatchId,
            status: BatchStatus.DRAFT,
            templateId: mockTemplateId,
          }),
          updateMany: vi.fn(),
        },
        certificateTemplate: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      });
    });

    await expect(
      updateTemplatePlacement(mockBatchId, {
        templateId: mockTemplateId,
        placement: DEFAULT_NAME_PLACEMENT,
      })
    ).rejects.toThrow(StaleTemplateConflictError);
  });

  it("throws validation error for invalid placement shape", async () => {
    const invalidPlacement = {
      xRatio: 0.5,
      yRatio: -1, // out of bounds
      maxWidthRatio: 0.7,
      alignment: "center",
    } as unknown as NamePlacement;

    await expect(
      updateTemplatePlacement(mockBatchId, {
        templateId: mockTemplateId,
        placement: invalidPlacement,
      })
    ).rejects.toThrow();
  });

  it("atomically updates CertificateTemplate.namePlacement when all preconditions pass", async () => {
    const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
      const typedCb = cb as unknown as MockTxCallback;
      return typedCb({
        certificateBatch: {
          findFirst: vi.fn().mockResolvedValue({
            id: mockBatchId,
            status: BatchStatus.DRAFT,
            templateId: mockTemplateId,
          }),
          updateMany: vi.fn(),
        },
        certificateTemplate: {
          updateMany: mockUpdateMany,
        },
      });
    });

    const result = await updateTemplatePlacement(mockBatchId, {
      templateId: mockTemplateId,
      placement: DEFAULT_NAME_PLACEMENT,
    });

    expect(result).toEqual({
      templateId: mockTemplateId,
      namePlacement: DEFAULT_NAME_PLACEMENT,
    });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: mockTemplateId,
        deletedAt: null,
        batches: {
          some: {
            id: mockBatchId,
            deletedAt: null,
            status: BatchStatus.DRAFT,
            templateId: mockTemplateId,
          },
        },
      },
      data: {
        namePlacement: DEFAULT_NAME_PLACEMENT,
      },
    });
  });
});
