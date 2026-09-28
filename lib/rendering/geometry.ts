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

const GEOMETRY_TOLERANCE_POINTS = 0.01;

/**
 * Validates and transforms Phase 5 normalized spatial coordinates (Top-Left origin)
 * into bottom-left anchored PDF page coordinates.
 */
export function calculatePdfCenterCoordinates(
  placement: NamePlacement,
  pageWidth: number,
  pageHeight: number
): PdfCenterCoordinates {
  if (pageWidth <= 0 || pageHeight <= 0 || !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) {
    throw new InvalidNamePlacementError(
      `Invalid page dimensions for coordinate transformation: width=${pageWidth}, height=${pageHeight}`
    );
  }

  const parseResult = namePlacementSchema.safeParse(placement);
  if (!parseResult.success) {
    throw new InvalidNamePlacementError(
      `Invalid name placement: ${parseResult.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  const validPlacement = parseResult.data;
  const centerX = validPlacement.xRatio * pageWidth;
  const centerYFromBottom = (1 - validPlacement.yRatio) * pageHeight;
  const maxWidth = validPlacement.maxWidthRatio * pageWidth;

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
 * Verifies that text box vertical bounds stay strictly within [0, pageHeight].
 */
export function checkVerticalPageSafety(
  top: number,
  bottom: number,
  pageHeight: number
): boolean {
  return top <= pageHeight + 1e-4 && bottom >= -1e-4;
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
 * Validates strict PDF page geometry for Phase 7 single-page rendering.
 *
 * Strict requirements:
 * 1. Rotation is 0 degrees.
 * 2. CropBox matches MediaBox in x, y, width, and height.
 * 3. CropBox / MediaBox origin is (0, 0).
 * 4. UserUnit is absent, default, or effectively 1.0.
 */
export function validatePdfPageGeometry(page: PDFPage): void {
  // 1. Rotation check
  const rotationAngle = page.getRotation().angle;
  if (rotationAngle % 360 !== 0) {
    throw new UnsupportedTemplateGeometryError(
      `PDF page has non-zero rotation (${rotationAngle}°). Templates with rotation are not supported in Phase 7.`
    );
  }

  // 2. CropBox vs MediaBox check
  const mediaBox = page.getMediaBox();
  const cropBox = page.getCropBox();

  const isOriginZero =
    Math.abs(cropBox.x) <= GEOMETRY_TOLERANCE_POINTS &&
    Math.abs(cropBox.y) <= GEOMETRY_TOLERANCE_POINTS;

  const matchesMediaBox =
    Math.abs(cropBox.x - mediaBox.x) <= GEOMETRY_TOLERANCE_POINTS &&
    Math.abs(cropBox.y - mediaBox.y) <= GEOMETRY_TOLERANCE_POINTS &&
    Math.abs(cropBox.width - mediaBox.width) <= GEOMETRY_TOLERANCE_POINTS &&
    Math.abs(cropBox.height - mediaBox.height) <= GEOMETRY_TOLERANCE_POINTS;

  if (!matchesMediaBox || !isOriginZero) {
    throw new UnsupportedTemplateGeometryError(
      `PDF page has non-standard MediaBox/CropBox geometry. CropBox [${cropBox.x}, ${cropBox.y}, ${cropBox.width}, ${cropBox.height}] must match MediaBox [${mediaBox.x}, ${mediaBox.y}, ${mediaBox.width}, ${mediaBox.height}] with origin (0, 0).`
    );
  }

  // 3. UserUnit check
  const rawUserUnit = page.node.get(PDFName.of("UserUnit"));
  if (rawUserUnit instanceof PDFNumber) {
    const unitValue = rawUserUnit.asNumber();
    if (Math.abs(unitValue - 1.0) > 1e-4) {
      throw new UnsupportedTemplateGeometryError(
        `PDF page has non-default UserUnit (${unitValue}). Non-standard user space scaling is not supported in Phase 7.`
      );
    }
  }
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
