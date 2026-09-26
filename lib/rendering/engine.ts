import { PDFDocument, rgb } from "pdf-lib";
import sharp, { Metadata } from "sharp";
import { TemplateFileType } from "@/generated/prisma/client";
import { NamePlacement } from "@/lib/coordinates";
import { normalizeParticipantName } from "@/lib/participants/normalize";
import {
  TemplateRenderError,
  UnsupportedTemplateGeometryError,
} from "./errors";
import {
  RenderCertificateStyle,
  calculatePdfCenterCoordinates,
  calculateImagePdfDimensions,
  validatePdfPageGeometry,
  validateRenderStyle,
} from "./geometry";
import {
  embedCustomFont,
  validateFontGlyphSupport,
} from "./font";
import {
  calculateNameLayout,
  NameLayoutPlan,
} from "./fitting";

export interface RenderCertificateInput {
  template: {
    fileType: TemplateFileType;
    sourceBytes: Uint8Array | Buffer;
    pageWidth?: number | null;
    pageHeight?: number | null;
  };
  placement: NamePlacement;
  participant: {
    name: string;
  };
  font: {
    fontBytes: Uint8Array | Buffer;
    fontFamily?: string;
  };
  style: RenderCertificateStyle;
  imageOptions?: {
    fallbackDpi?: number;
  };
}

export interface RenderCertificateResult {
  pdfBytes: Uint8Array;
  pageWidth: number;
  pageHeight: number;
  renderedName: string;
  fontSize: number;
  layoutPlan: NameLayoutPlan;
  textWidth: number;
  baselineY: number;
}

/**
 * Pure deterministic server-side rendering primitive.
 *
 * Transforms ONE validated certificate template (PDF, PNG, or JPG)
 * plus ONE participant name into ONE valid single-page PDF certificate.
 *
 * Rules:
 * - Source artwork remains visually untouched; only the participant name is overlaid.
 * - Single-line rendering only (Phase 7): throws NameDoesNotFitError if textWidth > maxWidth.
 * - In-memory byte-only execution: no database mutation, no storage upload.
 */
export async function renderSingleCertificate(
  input: RenderCertificateInput
): Promise<RenderCertificateResult> {
  // 1. Validate & normalize participant name
  const normalizedName = normalizeParticipantName(input.participant?.name);
  if (!normalizedName) {
    throw new TemplateRenderError("Participant name is required and cannot be blank.");
  }

  // 2. Validate explicit render style (fontSize and textColor required)
  validateRenderStyle(input.style);

  // 3. Validate template source bytes presence
  const sourceBytes = input.template?.sourceBytes;
  if (!sourceBytes || sourceBytes.byteLength === 0) {
    throw new TemplateRenderError("Template source bytes are empty or undefined.");
  }

  const { fileType } = input.template;

  // Branch A: PDF Template
  if (fileType === TemplateFileType.PDF) {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(sourceBytes, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("encrypt") || msg.toLowerCase().includes("password")) {
        throw new TemplateRenderError("Password-protected or encrypted PDFs are not supported.");
      }
      throw new TemplateRenderError(`Corrupt or unreadable PDF template: ${msg}`);
    }

    const pageCount = doc.getPageCount();
    if (pageCount !== 1) {
      throw new TemplateRenderError(
        `PDF template must be exactly 1 page (received ${pageCount} pages).`
      );
    }

    const page = doc.getPage(0);

    // Validate PDF geometry: 0 degree rotation, MediaBox === CropBox, UserUnit === 1
    validatePdfPageGeometry(page);

    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Verify stored metadata consistency if provided
    if (
      typeof input.template.pageWidth === "number" &&
      typeof input.template.pageHeight === "number"
    ) {
      const wDiff = Math.abs(pageWidth - input.template.pageWidth);
      const hDiff = Math.abs(pageHeight - input.template.pageHeight);
      if (wDiff > 1.0 || hDiff > 1.0) {
        throw new TemplateRenderError(
          `Persisted template metadata (${input.template.pageWidth}x${input.template.pageHeight}) does not match actual PDF dimensions (${pageWidth}x${pageHeight}).`
        );
      }
    }

    // Embed deterministic custom font
    const font = await embedCustomFont(
      doc,
      input.font.fontBytes,
      input.font.fontFamily
    );

    // Validate font glyph support for full Unicode code points
    validateFontGlyphSupport(font, normalizedName, input.font.fontFamily);

    // Transform coordinates
    const { centerX, centerYFromBottom, maxWidth } = calculatePdfCenterCoordinates(
      input.placement,
      pageWidth,
      pageHeight
    );

    // Calculate layout plan using Phase 8 authoritative fitting policy
    const layoutPlan = calculateNameLayout({
      name: normalizedName,
      font,
      centerX,
      centerYFromBottom,
      maxWidth,
      pageHeight,
      style: input.style,
    });

    // Draw all lines from the layout plan
    for (const line of layoutPlan.lines) {
      page.drawText(line.text, {
        x: line.startX,
        y: line.baselineY,
        size: layoutPlan.fontSize,
        font,
        color: rgb(
          input.style.textColor.r,
          input.style.textColor.g,
          input.style.textColor.b
        ),
      });
    }

    const pdfBytes = await doc.save();

    return {
      pdfBytes,
      pageWidth,
      pageHeight,
      renderedName: normalizedName,
      fontSize: layoutPlan.fontSize,
      layoutPlan,
      textWidth: layoutPlan.lines[0].width,
      baselineY: layoutPlan.lines[0].baselineY,
    };
  }

  // Branch B: PNG or JPG Template -> Single Page PDF Output
  if (
    fileType === TemplateFileType.PNG ||
    fileType === TemplateFileType.JPG
  ) {
    let metadata: Metadata;
    try {
      metadata = await sharp(sourceBytes).metadata();
    } catch (err: unknown) {
      throw new TemplateRenderError(
        `Failed to decode template image: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
      throw new TemplateRenderError("Invalid or missing image dimensions in template.");
    }

    if (fileType === TemplateFileType.PNG && metadata.format !== "png") {
      throw new TemplateRenderError(
        `Declared fileType PNG does not match image format "${metadata.format}".`
      );
    }

    if (fileType === TemplateFileType.JPG && metadata.format !== "jpeg") {
      throw new TemplateRenderError(
        `Declared fileType JPG does not match image format "${metadata.format}".`
      );
    }

    // EXIF orientation guardrail: 1 or undefined is supported; 2..8 rejected
    if (metadata.orientation !== undefined && metadata.orientation !== 1) {
      throw new UnsupportedTemplateGeometryError(
        `Template image has non-standard EXIF orientation (${metadata.orientation}). Auto-rotation/re-encoding is not supported in Phase 7.`
      );
    }

    // Calculate physical page size in points using density or fallback
    const { pageWidth, pageHeight } = calculateImagePdfDimensions(
      metadata.width,
      metadata.height,
      metadata.density,
      input.imageOptions?.fallbackDpi
    );

    // Verify stored metadata consistency if provided (comparing aspect ratio)
    if (
      typeof input.template.pageWidth === "number" &&
      typeof input.template.pageHeight === "number" &&
      input.template.pageWidth > 0 &&
      input.template.pageHeight > 0
    ) {
      const actualAspect = metadata.width / metadata.height;
      const storedAspect = input.template.pageWidth / input.template.pageHeight;
      if (Math.abs(actualAspect - storedAspect) > 0.01) {
        throw new TemplateRenderError(
          `Persisted template metadata aspect ratio (${storedAspect.toFixed(4)}) does not match actual image aspect ratio (${actualAspect.toFixed(4)}).`
        );
      }
    }

    // Create new single-page PDF document
    const doc = await PDFDocument.create();

    // Embed image into document without re-encoding
    let embeddedImage;
    try {
      if (fileType === TemplateFileType.PNG) {
        embeddedImage = await doc.embedPng(sourceBytes);
      } else {
        embeddedImage = await doc.embedJpg(sourceBytes);
      }
    } catch (embedErr: unknown) {
      throw new TemplateRenderError(
        `Failed to embed template image into PDF: ${embedErr instanceof Error ? embedErr.message : String(embedErr)}`
      );
    }

    // Add exactly one page with physical dimensions
    const page = doc.addPage([pageWidth, pageHeight]);

    // Draw background image edge-to-edge
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });

    // Embed deterministic custom font
    const font = await embedCustomFont(
      doc,
      input.font.fontBytes,
      input.font.fontFamily
    );

    // Validate glyph support for full Unicode code points
    validateFontGlyphSupport(font, normalizedName, input.font.fontFamily);

    // Transform coordinates
    const { centerX, centerYFromBottom, maxWidth } = calculatePdfCenterCoordinates(
      input.placement,
      pageWidth,
      pageHeight
    );

    // Calculate layout plan using Phase 8 authoritative fitting policy
    const layoutPlan = calculateNameLayout({
      name: normalizedName,
      font,
      centerX,
      centerYFromBottom,
      maxWidth,
      pageHeight,
      style: input.style,
    });

    // Draw all lines from the layout plan
    for (const line of layoutPlan.lines) {
      page.drawText(line.text, {
        x: line.startX,
        y: line.baselineY,
        size: layoutPlan.fontSize,
        font,
        color: rgb(
          input.style.textColor.r,
          input.style.textColor.g,
          input.style.textColor.b
        ),
      });
    }

    const pdfBytes = await doc.save();

    return {
      pdfBytes,
      pageWidth,
      pageHeight,
      renderedName: normalizedName,
      fontSize: layoutPlan.fontSize,
      layoutPlan,
      textWidth: layoutPlan.lines[0].width,
      baselineY: layoutPlan.lines[0].baselineY,
    };
  }

  throw new TemplateRenderError(`Unsupported template file type: ${String(fileType)}`);
}
