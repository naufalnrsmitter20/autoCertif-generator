import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  validateTemplateBytes,
  validateStoragePathNamespace,
  validateExtensionMatchesMime,
  sanitizeTemplateName,
} from "@/lib/validations/template-file";
import { TemplateFileType } from "@/generated/prisma/client";
import { MAX_TEMPLATE_FILE_SIZE_BYTES } from "@/lib/storage/constants";

describe("Template File Validation", () => {
  describe("validateStoragePathNamespace", () => {
    it("accepts valid storage path matching batch namespace and supported extension", () => {
      const res = validateStoragePathNamespace("templates/batch-123/uuid-123.pdf", "batch-123");
      expect(res.isValid).toBe(true);
      expect(res.extension).toBe(".pdf");
    });

    it("rejects path with mismatched batchId namespace", () => {
      const res = validateStoragePathNamespace("templates/batch-456/uuid-123.pdf", "batch-123");
      expect(res.isValid).toBe(false);
    });

    it("rejects path traversal attempts", () => {
      expect(validateStoragePathNamespace("../templates/batch-123/uuid.pdf", "batch-123").isValid).toBe(false);
      expect(validateStoragePathNamespace("templates/batch-123/../uuid.pdf", "batch-123").isValid).toBe(false);
      expect(validateStoragePathNamespace("/templates/batch-123/uuid.pdf", "batch-123").isValid).toBe(false);
    });

    it("rejects unsupported extensions", () => {
      expect(validateStoragePathNamespace("templates/batch-123/uuid.exe", "batch-123").isValid).toBe(false);
      expect(validateStoragePathNamespace("templates/batch-123/uuid.svg", "batch-123").isValid).toBe(false);
    });
  });

  describe("validateExtensionMatchesMime", () => {
    it("validates PDF extensions", () => {
      expect(validateExtensionMatchesMime(".pdf", "application/pdf")).toBe(true);
      expect(validateExtensionMatchesMime(".png", "application/pdf")).toBe(false);
    });

    it("validates PNG extensions", () => {
      expect(validateExtensionMatchesMime(".png", "image/png")).toBe(true);
      expect(validateExtensionMatchesMime(".jpg", "image/png")).toBe(false);
    });

    it("validates JPEG extensions (.jpg and .jpeg)", () => {
      expect(validateExtensionMatchesMime(".jpg", "image/jpeg")).toBe(true);
      expect(validateExtensionMatchesMime(".jpeg", "image/jpeg")).toBe(true);
      expect(validateExtensionMatchesMime(".png", "image/jpeg")).toBe(false);
    });
  });

  describe("sanitizeTemplateName", () => {
    it("removes extension and strips directory path traversal", () => {
      expect(sanitizeTemplateName("../../certificates/spring-workshop.pdf")).toBe("spring-workshop");
    });

    it("collapses multiple spaces and removes unsafe characters", () => {
      expect(sanitizeTemplateName("Award #123 (Final) -- 2026.png")).toBe("Award 123 Final -- 2026");
    });

    it("falls back to default name if stripped name is blank", () => {
      expect(sanitizeTemplateName(".pdf")).toBe("Certificate Template");
    });
  });

  describe("validateTemplateBytes — PDF", () => {
    it("accepts a valid single-page PDF and extracts trusted dimensions", async () => {
      const doc = await PDFDocument.create();
      doc.addPage([842, 595]); // A4 landscape
      const bytes = await doc.save();
      const buffer = Buffer.from(bytes);

      const result = await validateTemplateBytes(
        buffer,
        "application/pdf",
        "templates/b-1/sample.pdf",
        "b-1"
      );

      expect(result.fileType).toBe(TemplateFileType.PDF);
      expect(result.width).toBe(842);
      expect(result.height).toBe(595);
    });

    it("rejects multi-page PDF with exact page count feedback", async () => {
      const doc = await PDFDocument.create();
      doc.addPage([600, 400]);
      doc.addPage([600, 400]);
      const bytes = await doc.save();
      const buffer = Buffer.from(bytes);

      await expect(
        validateTemplateBytes(buffer, "application/pdf", "templates/b-1/sample.pdf", "b-1")
      ).rejects.toThrow(/Multi-page PDFs are not supported.*received 2 pages/);
    });

    it("rejects file with invalid PDF header signature", async () => {
      const fakeBuffer = Buffer.from("NOT_A_PDF_HEADER_CONTENT");

      await expect(
        validateTemplateBytes(fakeBuffer, "application/pdf", "templates/b-1/sample.pdf", "b-1")
      ).rejects.toThrow(/invalid header signature/);
    });

    it("rejects corrupt PDF file", async () => {
      const corruptBuffer = Buffer.from("%PDF-1.4 garbage corrupt bytes unreadable");

      await expect(
        validateTemplateBytes(corruptBuffer, "application/pdf", "templates/b-1/sample.pdf", "b-1")
      ).rejects.toThrow(/corrupt or unreadable/);
    });
  });

  describe("validateTemplateBytes — PNG & JPEG", () => {
    it("accepts valid PNG and extracts trusted dimensions", async () => {
      const pngBuffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const result = await validateTemplateBytes(
        pngBuffer,
        "image/png",
        "templates/b-1/sample.png",
        "b-1"
      );

      expect(result.fileType).toBe(TemplateFileType.PNG);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it("accepts valid JPEG and extracts trusted dimensions", async () => {
      const jpegBuffer = await sharp({
        create: {
          width: 1024,
          height: 768,
          channels: 3,
          background: { r: 50, g: 100, b: 150 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await validateTemplateBytes(
        jpegBuffer,
        "image/jpeg",
        "templates/b-1/sample.jpg",
        "b-1"
      );

      expect(result.fileType).toBe(TemplateFileType.JPG);
      expect(result.width).toBe(1024);
      expect(result.height).toBe(768);
    });

    it("authoritatively rejects format mismatch (e.g. declared PNG, actual JPEG)", async () => {
      const jpegBuffer = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .jpeg()
        .toBuffer();

      await expect(
        validateTemplateBytes(jpegBuffer, "image/png", "templates/b-1/sample.png", "b-1")
      ).rejects.toThrow(/mismatches declared "image\/png"/);
    });

    it("rejects corrupt/unsupported image content", async () => {
      const corruptImage = Buffer.from("\x89PNG\r\n\x1a\nCorruptImageContentGarbage");

      await expect(
        validateTemplateBytes(corruptImage, "image/png", "templates/b-1/sample.png", "b-1")
      ).rejects.toThrow(/Corrupt or unsupported image/);
    });
  });

  describe("Size & General Constraints", () => {
    it("rejects empty file buffer (0 bytes)", async () => {
      await expect(
        validateTemplateBytes(Buffer.alloc(0), "application/pdf", "templates/b-1/sample.pdf", "b-1")
      ).rejects.toThrow(/empty \(0 bytes\)/);
    });

    it("rejects file exceeding technical maximum limit (10 MB)", async () => {
      const oversizedBuffer = Buffer.alloc(MAX_TEMPLATE_FILE_SIZE_BYTES + 1);

      await expect(
        validateTemplateBytes(
          oversizedBuffer,
          "application/pdf",
          "templates/b-1/sample.pdf",
          "b-1"
        )
      ).rejects.toThrow(/exceeds technical maximum of 10 MB/);
    });

    it("rejects storage path extension mismatch with declared MIME", async () => {
      const doc = await PDFDocument.create();
      doc.addPage([100, 100]);
      const bytes = await doc.save();
      const buffer = Buffer.from(bytes);

      await expect(
        validateTemplateBytes(buffer, "application/pdf", "templates/b-1/sample.jpg", "b-1")
      ).rejects.toThrow(/does not match declared MIME type/);
    });
  });
});
