import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initiateTemplateUpload,
  finalizeTemplateUpload,
  getTemplatePreviewSignedUrl,
  TemplateEligibilityError,
  ConcurrentModificationError,
} from "@/lib/templates";
import { AdminAuthError } from "@/lib/auth/guard";
import { BatchNotFoundError } from "@/lib/batches";
import { BatchStatus, TemplateFileType } from "@/generated/prisma/client";
import { TemplateValidationError } from "@/lib/validations/template-file";

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

vi.mock("@/lib/storage/server", () => ({
  createTemplateSignedUploadUrl: vi.fn(),
  downloadTemplateBuffer: vi.fn(),
  deleteTemplateObject: vi.fn(),
  createTemplateSignedReadUrl: vi.fn(),
  StorageOperationError: class StorageOperationError extends Error {},
  StorageConfigurationError: class StorageConfigurationError extends Error {},
}));

vi.mock("@/lib/validations/template-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/validations/template-file")>();
  return {
    ...actual,
    validateTemplateBytes: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    certificateBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    certificateTemplate: {
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { requireAdmin } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import {
  createTemplateSignedUploadUrl,
  downloadTemplateBuffer,
  deleteTemplateObject,
  createTemplateSignedReadUrl,
} from "@/lib/storage/server";
import { validateTemplateBytes } from "@/lib/validations/template-file";

describe("Template Service Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      id: "admin-1",
      email: "admin@autocertif.local",
      role: "ADMIN",
    });
  });

  describe("initiateTemplateUpload", () => {
    it("rejects unauthenticated caller before any database or storage action", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());

      await expect(
        initiateTemplateUpload("batch-1", {
          filename: "template.pdf",
          mimeType: "application/pdf",
          size: 1024,
        })
      ).rejects.toThrow(AdminAuthError);

      expect(prisma.certificateBatch.findFirst).not.toHaveBeenCalled();
      expect(createTemplateSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("rejects nonexistent or soft-deleted batch", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce(null);

      await expect(
        initiateTemplateUpload("batch-missing", {
          filename: "template.pdf",
          mimeType: "application/pdf",
          size: 1024,
        })
      ).rejects.toThrow(BatchNotFoundError);

      expect(createTemplateSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("rejects non-DRAFT batch with TemplateEligibilityError", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.PUBLISHED,
      } as never);

      await expect(
        initiateTemplateUpload("batch-1", {
          filename: "template.pdf",
          mimeType: "application/pdf",
          size: 1024,
        })
      ).rejects.toThrow(TemplateEligibilityError);

      expect(createTemplateSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("rejects extension mismatch between filename and declared MIME type", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.DRAFT,
      } as never);

      await expect(
        initiateTemplateUpload("batch-1", {
          filename: "template.png",
          mimeType: "application/pdf",
          size: 1024,
        })
      ).rejects.toThrow(TemplateValidationError);

      expect(createTemplateSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("generates collision-resistant unique storage path and issues signed upload URL with { upsert: false }", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.DRAFT,
      } as never);

      vi.mocked(createTemplateSignedUploadUrl).mockResolvedValueOnce({
        signedUrl: "https://storage.supabase.co/signed/upload",
        token: "token-123",
        path: "templates/batch-1/candidate.pdf",
      });

      const res = await initiateTemplateUpload("batch-1", {
        filename: "my-certificate.pdf",
        mimeType: "application/pdf",
        size: 500000,
      });

      expect(createTemplateSignedUploadUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^templates\/batch-1\/[a-zA-Z0-9-]+\.pdf$/)
      );
      expect(res.signedUrl).toBe("https://storage.supabase.co/signed/upload");
      expect(res.token).toBe("token-123");
    });
  });

  describe("finalizeTemplateUpload", () => {
    const validPath = "templates/batch-1/uuid-abc.pdf";

    it("rejects unauthenticated caller", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());

      await expect(
        finalizeTemplateUpload("batch-1", {
          storagePath: validPath,
          originalFilename: "template.pdf",
          declaredMimeType: "application/pdf",
        })
      ).rejects.toThrow(AdminAuthError);
    });

    it("rejects candidate storage path from unauthorized namespace", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.DRAFT,
        templateId: null,
      } as never);

      await expect(
        finalizeTemplateUpload("batch-1", {
          storagePath: "templates/other-batch/uuid-abc.pdf",
          originalFilename: "template.pdf",
          declaredMimeType: "application/pdf",
        })
      ).rejects.toThrow(TemplateValidationError);
    });

    it("cleans up invalid candidate object from storage when byte validation fails", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.DRAFT,
        templateId: null,
      } as never);

      vi.mocked(downloadTemplateBuffer).mockResolvedValueOnce(Buffer.from("corrupt"));
      vi.mocked(validateTemplateBytes).mockRejectedValueOnce(
        new TemplateValidationError("Multi-page PDFs are not supported.")
      );

      await expect(
        finalizeTemplateUpload("batch-1", {
          storagePath: validPath,
          originalFilename: "template.pdf",
          declaredMimeType: "application/pdf",
        })
      ).rejects.toThrow("Multi-page PDFs are not supported.");

      // Verifies compensating cleanup on candidate
      expect(deleteTemplateObject).toHaveBeenCalledWith(validPath);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("atomically creates CertificateTemplate and updates batch.templateId on successful validation", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.DRAFT,
        templateId: null,
      } as never);

      vi.mocked(downloadTemplateBuffer).mockResolvedValueOnce(Buffer.from("%PDF-1.4..."));
      vi.mocked(validateTemplateBytes).mockResolvedValueOnce({
        fileType: TemplateFileType.PDF,
        width: 800,
        height: 600,
      });

      const mockTemplate = {
        id: "template-new",
        name: "Certificate Template",
        fileType: TemplateFileType.PDF,
        sourceFilePath: validPath,
        pageWidth: 800,
        pageHeight: 600,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
        const tx = {
          certificateTemplate: {
            create: vi.fn().mockResolvedValueOnce(mockTemplate),
            update: vi.fn(),
          },
          certificateBatch: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            count: vi.fn(),
          },
        };
        return cb(tx as never);
      });

      const result = await finalizeTemplateUpload("batch-1", {
        storagePath: validPath,
        originalFilename: "Certificate Template.pdf",
        declaredMimeType: "application/pdf",
      });

      expect(result.id).toBe("template-new");
      expect(result.fileType).toBe(TemplateFileType.PDF);
      expect(deleteTemplateObject).not.toHaveBeenCalled();
    });

    it("aborts safely and cleans up candidate if batch was concurrently modified during finalization", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.DRAFT,
        templateId: null,
      } as never);

      vi.mocked(downloadTemplateBuffer).mockResolvedValueOnce(Buffer.from("%PDF-1.4..."));
      vi.mocked(validateTemplateBytes).mockResolvedValueOnce({
        fileType: TemplateFileType.PDF,
        width: 800,
        height: 600,
      });

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
        const tx = {
          certificateTemplate: {
            create: vi.fn().mockResolvedValueOnce({ id: "template-orphan" }),
          },
          certificateBatch: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 0 }), // Concurrent change detected!
          },
        };
        return cb(tx as never);
      });

      await expect(
        finalizeTemplateUpload("batch-1", {
          storagePath: validPath,
          originalFilename: "Certificate Template.pdf",
          declaredMimeType: "application/pdf",
        })
      ).rejects.toThrow(ConcurrentModificationError);

      // Verifies compensating cleanup on candidate
      expect(deleteTemplateObject).toHaveBeenCalledWith(validPath);
    });

    it("soft-deletes old template on replacement only if no other active batch still references it", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.DRAFT,
        templateId: "old-template-id",
      } as never);

      vi.mocked(downloadTemplateBuffer).mockResolvedValueOnce(Buffer.from("%PDF-1.4..."));
      vi.mocked(validateTemplateBytes).mockResolvedValueOnce({
        fileType: TemplateFileType.PDF,
        width: 800,
        height: 600,
      });

      const mockTemplateUpdate = vi.fn();

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
        const tx = {
          certificateTemplate: {
            create: vi.fn().mockResolvedValueOnce({ id: "new-template-id" }),
            update: mockTemplateUpdate,
          },
          certificateBatch: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            count: vi.fn().mockResolvedValueOnce(0), // No other batch references old-template-id
          },
        };
        return cb(tx as never);
      });

      await finalizeTemplateUpload("batch-1", {
        storagePath: validPath,
        originalFilename: "New Template.pdf",
        declaredMimeType: "application/pdf",
      });

      expect(mockTemplateUpdate).toHaveBeenCalledWith({
        where: { id: "old-template-id" },
        data: {
          deletedAt: expect.any(Date),
        },
      });
    });

    it("does NOT soft-delete old template if another active batch still references it", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        status: BatchStatus.DRAFT,
        templateId: "shared-template-id",
      } as never);

      vi.mocked(downloadTemplateBuffer).mockResolvedValueOnce(Buffer.from("%PDF-1.4..."));
      vi.mocked(validateTemplateBytes).mockResolvedValueOnce({
        fileType: TemplateFileType.PDF,
        width: 800,
        height: 600,
      });

      const mockTemplateUpdate = vi.fn();

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb) => {
        const tx = {
          certificateTemplate: {
            create: vi.fn().mockResolvedValueOnce({ id: "new-template-id" }),
            update: mockTemplateUpdate,
          },
          certificateBatch: {
            updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
            count: vi.fn().mockResolvedValueOnce(1), // Another batch DOES reference shared-template-id
          },
        };
        return cb(tx as never);
      });

      await finalizeTemplateUpload("batch-1", {
        storagePath: validPath,
        originalFilename: "New Template.pdf",
        declaredMimeType: "application/pdf",
      });

      expect(mockTemplateUpdate).not.toHaveBeenCalled();
    });
  });

  describe("getTemplatePreviewSignedUrl", () => {
    it("rejects unauthorized caller", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new AdminAuthError());

      await expect(getTemplatePreviewSignedUrl("batch-1")).rejects.toThrow(AdminAuthError);
    });

    it("creates short-lived signed read URL for active batch template", async () => {
      vi.mocked(prisma.certificateBatch.findFirst).mockResolvedValueOnce({
        id: "batch-1",
        template: {
          id: "temp-1",
          sourceFilePath: "templates/batch-1/abc.pdf",
          deletedAt: null,
        },
      } as never);

      vi.mocked(createTemplateSignedReadUrl).mockResolvedValueOnce(
        "https://storage.supabase.co/signed/read"
      );

      const url = await getTemplatePreviewSignedUrl("batch-1");

      expect(createTemplateSignedReadUrl).toHaveBeenCalledWith("templates/batch-1/abc.pdf");
      expect(url).toBe("https://storage.supabase.co/signed/read");
    });
  });
});
