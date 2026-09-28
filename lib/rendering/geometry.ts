import { PDFPage, PDFName, PDFNumber } from "pdf-lib";
import { NamePlacement, namePlacementSchema } from "@/lib/coordinates";
import {
  InvalidNamePlacementError,
  InvalidRenderStyleError,
  UnsupportedTemplateGeometryError,
} from "./errors";

export interface RenderCertificateStyle {
  fontSize: number;
  minFontSize: number;
  lineHeightMultiplier: number;
  textColor: {
    r: number;
    g: number;
    b: number;
  };
  stepSize?: number;
}

export interface PdfCenterCoordinates {
  centerX: number;
  centerYFromBottom: number;
  maxWidth: number;
}

export interface ImagePdfDimensions {
  pageWidth: number;
  pageHeight: number;
  effectiveDpi: number;
  isFallbackDpi: boolean;
}

/**
 * The visible CropBox of a PDF page, expressed in PDF user-space points.
 * Origin (x, y) is the bottom-left corner of the CropBox in the page's
 * MediaBox coordinate space. Width and height are the visible dimensions.
 */
export interface PdfCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GEOMETRY_TOLERANCE_POINTS = 0.01;

/**
 * Validates and transforms Phase 5 normalized spatial coordinates (Top-Left origin)
 * into PDF page coordinates relative to the visible CropBox.
 *
 * The CropBox is treated as the certificate rendering surface. xRatio/yRatio/
 * maxWidthRatio are fractions of the CropBox width/height. The resulting
 * centerX and centerYFromBottom are absolute PDF user-space coordinates that
 * account for any non-zero CropBox origin offset.
 *
 * When cropBoxOrigin is omitted (or {x:0, y:0}), behaviour is identical to
 * the previous single-argument form, so all image-path and zero-origin PDF
 * callers are unaffected.
 */
export function calculatePdfCenterCoordinates(
  placement: NamePlacement,
  cropBoxWidth: number,
  cropBoxHeight: number,
  cropBoxOrigin: { x: number; y: number } = { x: 0, y: 0 }
): PdfCenterCoordinates {
  if (
    cropBoxWidth <= 0 ||
    cropBoxHeight <= 0 ||
    !Number.isFinite(cropBoxWidth) ||
    !Number.isFinite(cropBoxHeight)
  ) {
    throw new InvalidNamePlacementError(
      `Invalid page dimensions for coordinate transformation: width=${cropBoxWidth}, height=${cropBoxHeight}`
    );
  }

  const parseResult = namePlacementSchema.safeParse(placement);
  if (!parseResult.success) {
    throw new InvalidNamePlacementError(
      `Invalid name placement: ${parseResult.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  const validPlacement = parseResult.data;

  // Placement ratios are relative to the CropBox surface.
  // centerX / centerYFromBottom are absolute PDF user-space coordinates:
  //   centerX            = cropBoxOrigin.x + xRatio * cropBoxWidth
  //   centerYFromBottom  = cropBoxOrigin.y + (1 - yRatio) * cropBoxHeight
  const centerX = cropBoxOrigin.x + validPlacement.xRatio * cropBoxWidth;
  const centerYFromBottom =
    cropBoxOrigin.y + (1 - validPlacement.yRatio) * cropBoxHeight;
  const maxWidth = validPlacement.maxWidthRatio * cropBoxWidth;

  return {
    centerX,
    centerYFromBottom,
    maxWidth,
  };
}

/**
 * Calculates the PDF baseline Y coordinate so that the full typographic/metric
 * box (from font descent to ascent) is centered around centerYFromBottom.
 *
 * Derivation:
 * Box top = baselineY + ascent
 * Box bottom = baselineY - descent
 * Box center = baselineY + (ascent - descent) / 2
 * Setting Box center = centerYFromBottom:
 * baselineY = centerYFromBottom - (ascent - descent) / 2
 */
export function calculateBaselineY(
  centerYFromBottom: number,
  ascent: number,
  descent: number
): number {
  return centerYFromBottom - (ascent - descent) / 2;
}

export interface TwoLineBaselines {
  baseline1: number;
  baseline2: number;
  lineHeight: number;
}

/**
 * Calculates PDF baseline Y coordinates for two centered lines separated by lineHeight.
 * Line 1 is the top line; Line 2 is the bottom line.
 */
export function calculateTwoLineBaselines(
  centerYFromBottom: number,
  ascent: number,
  descent: number,
  lineHeight: number
): TwoLineBaselines {
  const halfLineHeight = lineHeight / 2;
  const metricOffset = (ascent - descent) / 2;
  const baseline1 = centerYFromBottom + halfLineHeight - metricOffset;
  const baseline2 = centerYFromBottom - halfLineHeight - metricOffset;

  return {
    baseline1,
    baseline2,
    lineHeight,
  };
}

/**
 * Verifies whether two typographic line boxes overlap.
 * Top line box bottom is (baseline1 - descent).
 * Bottom line box top is (baseline2 + ascent).
 * Boxes do not overlap if (baseline1 - descent) >= (baseline2 + ascent).
 */
export function checkTwoLineBoxesOverlap(
  baseline1: number,
  baseline2: number,
  ascent: number,
  descent: number
): boolean {
  const topLineBottom = baseline1 - descent;
  const bottomLineTop = baseline2 + ascent;
  return topLineBottom < bottomLineTop - 1e-4;
}

/**
 * Verifies that text box vertical bounds stay strictly within [cropBoxY, cropBoxY + cropBoxHeight].
 *
 * For zero-origin surfaces cropBoxY defaults to 0, preserving the original contract.
 */
export function checkVerticalPageSafety(
  top: number,
  bottom: number,
  pageHeight: number,
  cropBoxY = 0
): boolean {
  const cropTop = cropBoxY + pageHeight;
  return top <= cropTop + 1e-4 && bottom >= cropBoxY - 1e-4;
}

/**
 * Calculates horizontal start coordinate (left edge of text) for center alignment.
 */
export function calculateStartX(centerX: number, textWidth: number, maxWidth?: number, alignment: NamePlacement["alignment"] = "center"): number {
  if (alignment === "left") return centerX - (maxWidth ?? textWidth) / 2;
  if (alignment === "right") return centerX + (maxWidth ?? textWidth) / 2 - textWidth;
  return centerX - textWidth / 2;
}

/**
 * Checks whether text width fits within maxWidth within floating-point tolerance.
 */
export function checkTextFits(textWidth: number, maxWidth: number): boolean {
  return textWidth <= maxWidth + 1e-4;
}

/**
 * Calculates physical PDF page dimensions from image pixels and density.
 *
 * Rules:
 * - If source density is present and in [72, 1200]: use it.
 * - Otherwise: use fallbackDpi (default 300) as an implementation fallback.
 * - Source metadata is never modified to claim it had 300 DPI.
 */
export function calculateImagePdfDimensions(
  pixelWidth: number,
  pixelHeight: number,
  sourceDensity?: number | null,
  fallbackDpi = 300
): ImagePdfDimensions {
  if (
    pixelWidth <= 0 ||
    pixelHeight <= 0 ||
    !Number.isFinite(pixelWidth) ||
    !Number.isFinite(pixelHeight)
  ) {
    throw new UnsupportedTemplateGeometryError(
      `Image pixel dimensions must be positive finite numbers (received: ${pixelWidth}x${pixelHeight}).`
    );
  }

  let effectiveDpi: number;
  let isFallbackDpi = false;

  if (
    typeof sourceDensity === "number" &&
    Number.isFinite(sourceDensity) &&
    sourceDensity >= 72 &&
    sourceDensity <= 1200
  ) {
    effectiveDpi = sourceDensity;
  } else {
    if (
      !Number.isFinite(fallbackDpi) ||
      fallbackDpi < 72 ||
      fallbackDpi > 1200
    ) {
      throw new UnsupportedTemplateGeometryError(
        `Fallback DPI must be a finite number between 72 and 1200 (received: ${fallbackDpi}).`
      );
    }
    effectiveDpi = fallbackDpi;
    isFallbackDpi = true;
  }

  const pageWidth = (pixelWidth * 72) / effectiveDpi;
  const pageHeight = (pixelHeight * 72) / effectiveDpi;

  return {
    pageWidth,
    pageHeight,
    effectiveDpi,
    isFallbackDpi,
  };
}

/**
 * Validates PDF page geometry for single-page rendering and returns the
 * visible CropBox so callers can use it as the rendering surface.
 *
 * Supported geometry:
 * 1. Rotation must be 0 degrees (non-zero rotation is not supported).
 * 2. CropBox must equal MediaBox in all four dimensions (x, y, width, height).
 *    A non-zero CropBox/MediaBox origin is now accepted: many PDF generators
 *    legitimately produce pages whose boxes start at e.g. (0, 8.58, ...).
 * 3. UserUnit must be absent or 1.0.
 *
 * What changed vs the previous contract:
 * - The "origin must be (0, 0)" requirement is removed. CropBox X/Y are now
 *   returned so the rendering engine can offset PDF-space coordinates correctly.
 * - CropBox == MediaBox is still required so the visible surface is unambiguous.
 *
 * Returns the CropBox so callers use its width/height for layout and its
 * x/y origin to translate normalised placement into absolute PDF coordinates.
 */
export function validatePdfPageGeometry(page: PDFPage): PdfCropBox {
  // 1. Rotation check
  const rotationAngle = page.getRotation().angle;
  if (rotationAngle % 360 !== 0) {
    throw new UnsupportedTemplateGeometryError(
      `PDF page has non-zero rotation (${rotationAngle}°). Templates with rotation are not supported.`
    );
  }

  // 2. CropBox vs MediaBox check
  const mediaBox = page.getMediaBox();
  const cropBox = page.getCropBox();

  const matchesMediaBox =
    Math.abs(cropBox.x - mediaBox.x) <= GEOMETRY_TOLERANCE_POINTS &&
    Math.abs(cropBox.y - mediaBox.y) <= GEOMETRY_TOLERANCE_POINTS &&
    Math.abs(cropBox.width - mediaBox.width) <= GEOMETRY_TOLERANCE_POINTS &&
    Math.abs(cropBox.height - mediaBox.height) <= GEOMETRY_TOLERANCE_POINTS;

  if (!matchesMediaBox) {
    throw new UnsupportedTemplateGeometryError(
      `PDF page CropBox [${cropBox.x}, ${cropBox.y}, ${cropBox.width}, ${cropBox.height}] does not match MediaBox [${mediaBox.x}, ${mediaBox.y}, ${mediaBox.width}, ${mediaBox.height}]. Templates where the visible area differs from the media area are not supported.`
    );
  }

  // 3. UserUnit check
  const rawUserUnit = page.node.get(PDFName.of("UserUnit"));
  if (rawUserUnit instanceof PDFNumber) {
    const unitValue = rawUserUnit.asNumber();
    if (Math.abs(unitValue - 1.0) > 1e-4) {
      throw new UnsupportedTemplateGeometryError(
        `PDF page has non-default UserUnit (${unitValue}). Non-standard user space scaling is not supported.`
      );
    }
  }

  return {
    x: cropBox.x,
    y: cropBox.y,
    width: cropBox.width,
    height: cropBox.height,
  };
}

/**
 * Validates explicit rendering style inputs.
 * fontSize, minFontSize, lineHeightMultiplier, and textColor are required.
 * stepSize is optional and defaults to 1.0 pt.
 */
export function validateRenderStyle(style: RenderCertificateStyle): void {
  if (!style) {
    throw new InvalidRenderStyleError("Render style is required.");
  }

  // 1. fontSize validation
  if (
    typeof style.fontSize !== "number" ||
    !Number.isFinite(style.fontSize) ||
    style.fontSize <= 0 ||
    style.fontSize > 500
  ) {
    throw new InvalidRenderStyleError(
      `fontSize must be a positive finite number <= 500 (received: ${style.fontSize}).`
    );
  }

  // 2. minFontSize validation (must NOT silently default to fontSize)
  if (
    typeof style.minFontSize !== "number" ||
    !Number.isFinite(style.minFontSize) ||
    style.minFontSize <= 0 ||
    style.minFontSize > 500
  ) {
    throw new InvalidRenderStyleError(
      `minFontSize must be a positive finite number <= 500 (received: ${style.minFontSize}).`
    );
  }

  if (style.minFontSize > style.fontSize) {
    throw new InvalidRenderStyleError(
      `minFontSize (${style.minFontSize}) cannot be greater than fontSize (${style.fontSize}).`
    );
  }

  // 3. lineHeightMultiplier validation (must not be silently invented)
  if (
    typeof style.lineHeightMultiplier !== "number" ||
    !Number.isFinite(style.lineHeightMultiplier) ||
    style.lineHeightMultiplier <= 0 ||
    style.lineHeightMultiplier > 5.0
  ) {
    throw new InvalidRenderStyleError(
      `lineHeightMultiplier must be a positive finite number <= 5.0 (received: ${style.lineHeightMultiplier}).`
    );
  }

  // 4. stepSize validation (if provided)
  const stepSize = style.stepSize ?? 1.0;
  if (
    typeof stepSize !== "number" ||
    !Number.isFinite(stepSize) ||
    stepSize <= 0 ||
    stepSize > 50
  ) {
    throw new InvalidRenderStyleError(
      `stepSize must be a positive finite number <= 50 (received: ${stepSize}).`
    );
  }

  // 5. textColor validation
  if (!style.textColor || typeof style.textColor !== "object") {
    throw new InvalidRenderStyleError("textColor object { r, g, b } is required.");
  }

  const { r, g, b } = style.textColor;
  const channels = [
    { name: "r", val: r },
    { name: "g", val: g },
    { name: "b", val: b },
  ];

  for (const { name, val } of channels) {
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0.0 || val > 1.0) {
      throw new InvalidRenderStyleError(
        `textColor channel "${name}" must be a finite number between 0.0 and 1.0 (received: ${val}).`
      );
    }
  }
}
