import { z } from "zod";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { TemplateFileType } from "@/generated/prisma/client";
import {
  MAX_TEMPLATE_FILE_SIZE_BYTES,
  ALLOWED_TEMPLATE_MIME_TYPES,
  AllowedTemplateMimeType,
} from "@/lib/storage/constants";

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateValidationError";
  }
}

export interface ValidatedTemplateResult {
  fileType: TemplateFileType;
  width: number;
  height: number;
}

export const preliminaryUploadInputSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, "Filename is required")
    .max(255, "Filename is too long"),
  mimeType: z.enum(ALLOWED_TEMPLATE_MIME_TYPES, {
    message: "File type must be application/pdf, image/png, or image/jpeg",
  }),
  size: z
    .number()
    .int("File size must be an integer")
    .positive("File size must be greater than 0")
    .max(
      MAX_TEMPLATE_FILE_SIZE_BYTES,
      `File size exceeds technical maximum of ${MAX_TEMPLATE_FILE_SIZE_BYTES / (1024 * 1024)} MB`
    ),
});

export type PreliminaryUploadInput = z.infer<typeof preliminaryUploadInputSchema>;

export const finalizeTemplateInputSchema = z.object({
  storagePath: z.string().trim().min(1, "Storage path is required"),
  originalFilename: z.string().trim().min(1, "Original filename is required"),
  declaredMimeType: z.enum(ALLOWED_TEMPLATE_MIME_TYPES, {
    message: "Declared file type must be application/pdf, image/png, or image/jpeg",
  }),
});

export type FinalizeTemplateInput = z.infer<typeof finalizeTemplateInputSchema>;

/**
 * Validates that an extension matches a declared MIME type.
 */
export function validateExtensionMatchesMime(
  extensionWithDot: string,
  mimeType: AllowedTemplateMimeType
): boolean {
  const ext = extensionWithDot.toLowerCase();
  switch (mimeType) {
    case "application/pdf":
      return ext === ".pdf";
    case "image/png":
      return ext === ".png";
    case "image/jpeg":
      return ext === ".jpg" || ext === ".jpeg";
    default:
      return false;
  }
}

/**
 * Returns a canonical extension (including leading dot) for a MIME type.
 */
export function getCanonicalExtension(mimeType: AllowedTemplateMimeType): string {
  switch (mimeType) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
  }
}

/**
 * Validates that a storage path matches the expected namespace:
 * templates/{batchId}/{candidateId}.{ext}
 */
export function validateStoragePathNamespace(
  storagePath: string,
  batchId: string
): { isValid: boolean; extension: string } {
  // Reject path traversal attempts
  if (storagePath.includes("..") || storagePath.includes("\\") || storagePath.startsWith("/")) {
    return { isValid: false, extension: "" };
  }

  const pattern = new RegExp(
    `^templates\\/${batchId}\\/([a-zA-Z0-9_-]+)\\.(pdf|png|jpg|jpeg)$`,
    "i"
  );
  const match = storagePath.match(pattern);

  if (!match) {
    return { isValid: false, extension: "" };
  }

  const ext = `.${match[2].toLowerCase()}`;
  return { isValid: true, extension: ext };
}

/**
 * Authoritatively validates uploaded file buffer, ensuring:
 * 1. Byte length <= 10 MB and > 0
 * 2. Path extension matches declared MIME type
 * 3. Actual decoded file format matches declared format
 * 4. Single-page PDF or valid image with positive dimensions
 */
export async function validateTemplateBytes(
  buffer: Buffer,
  declaredMimeType: AllowedTemplateMimeType,
  storagePath: string,
  batchId: string
): Promise<ValidatedTemplateResult> {
  // 1. Authoritative byte length check
  if (!buffer || buffer.length === 0) {
    throw new TemplateValidationError("Uploaded file is empty (0 bytes).");
  }

  if (buffer.length > MAX_TEMPLATE_FILE_SIZE_BYTES) {
    throw new TemplateValidationError(
      `File size (${(buffer.length / (1024 * 1024)).toFixed(
        2
      )} MB) exceeds technical maximum of ${
        MAX_TEMPLATE_FILE_SIZE_BYTES / (1024 * 1024)
      } MB.`
    );
  }

  // 2. Namespace and extension check
  const { isValid, extension: pathExt } = validateStoragePathNamespace(storagePath, batchId);
  if (!isValid) {
    throw new TemplateValidationError(
      "Invalid storage object path or unauthorized namespace."
    );
  }

  // 3. Extension must match declared MIME
  if (!validateExtensionMatchesMime(pathExt, declaredMimeType)) {
    throw new TemplateValidationError(
      `Storage path extension "${pathExt}" does not match declared MIME type "${declaredMimeType}".`
    );
  }

  // 4. Authoritative byte decoding & validation
  if (declaredMimeType === "application/pdf") {
    // Check magic bytes %PDF
    if (buffer.length < 4 || buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
      throw new TemplateValidationError(
        "File contents do not match PDF specification (invalid header signature)."
      );
    }

    let pdfDoc: PDFDocument;
    let pageCount = 0;
    let width = 0;
    let height = 0;

    try {
      pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: false });
      pageCount = pdfDoc.getPageCount();
      if (pageCount === 1) {
        const page = pdfDoc.getPage(0);
        const size = page.getSize();
        width = size.width;
        height = size.height;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("encrypt") || message.toLowerCase().includes("password")) {
        throw new TemplateValidationError("Password-protected or encrypted PDFs are not supported.");
      }
      throw new TemplateValidationError("The uploaded PDF file is corrupt or unreadable.");
    }

    if (pageCount !== 1) {
      throw new TemplateValidationError(
        `Multi-page PDFs are not supported. Certificate template must be exactly 1 page (received ${pageCount} pages).`
      );
    }

    if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
      throw new TemplateValidationError("Invalid PDF page dimensions.");
    }

    return {
      fileType: TemplateFileType.PDF,
      width,
      height,
    };
  }

  // Declared format is PNG or JPEG
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.format) {
      throw new TemplateValidationError("Unable to determine image format.");
    }

    // Authoritative check: decoded format must agree with declared MIME
    if (declaredMimeType === "image/png" && metadata.format !== "png") {
      throw new TemplateValidationError(
        `File content is decoded as "${metadata.format}", which mismatches declared "image/png".`
      );
    }

    if (
      declaredMimeType === "image/jpeg" &&
      metadata.format !== "jpeg"
    ) {
      throw new TemplateValidationError(
        `File content is decoded as "${metadata.format}", which mismatches declared "image/jpeg".`
      );
    }

    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width <= 0 ||
      metadata.height <= 0
    ) {
      throw new TemplateValidationError("Invalid image dimensions.");
    }

    return {
      fileType: metadata.format === "png" ? TemplateFileType.PNG : TemplateFileType.JPG,
      width: metadata.width,
      height: metadata.height,
    };
  } catch (err: unknown) {
    if (err instanceof TemplateValidationError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Unprocessable image";
    throw new TemplateValidationError(`Corrupt or unsupported image file: ${message}`);
  }
}

/**
 * Derives a clean display name from an original filename.
 * Strips path traversal, drops extension, collapses whitespace, bounds length.
 */
export function sanitizeTemplateName(originalFilename: string): string {
  const base = path.basename(originalFilename);
  const withoutExt = base.replace(/\.[^/.]+$/, "");
  const sanitized = withoutExt
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) {
    return "Certificate Template";
  }

  return sanitized.slice(0, 100);
}
