import { describe, it, expect } from "vitest";
import { PDFDocument, degrees, PDFName, PDFNumber } from "pdf-lib";
import {
  calculatePdfCenterCoordinates,
  calculateBaselineY,
  calculateTwoLineBaselines,
  checkTwoLineBoxesOverlap,
  checkVerticalPageSafety,
  calculateStartX,
  checkTextFits,
  calculateImagePdfDimensions,
  validatePdfPageGeometry,
  validateRenderStyle,
  type PdfCropBox,
} from "@/lib/rendering/geometry";
import {
  InvalidNamePlacementError,
  InvalidRenderStyleError,
  UnsupportedTemplateGeometryError,
} from "@/lib/rendering/errors";
import { NamePlacement } from "@/lib/coordinates";

describe("Rendering Geometry & Transformations", () => {
  describe("calculatePdfCenterCoordinates", () => {
    it("converts Top-Left normalized center to PDF Bottom-Left page coordinates", () => {
      const placement: NamePlacement = {
        xRatio: 0.5,
        yRatio: 0.4,
        maxWidthRatio: 0.8,
        alignment: "center",
      };

      const result = calculatePdfCenterCoordinates(placement, 800, 600);

      // Horizontal: 0.5 * 800 = 400
      expect(result.centerX).toBe(400);
      // Vertical: (1 - 0.4) * 600 = 360 from bottom
      expect(result.centerYFromBottom).toBe(360);
      // Max width: 0.8 * 800 = 640
      expect(result.maxWidth).toBe(640);
    });

    it("rejects non-positive or non-finite page dimensions", () => {
      const placement: NamePlacement = {
        xRatio: 0.5,
        yRatio: 0.5,
        maxWidthRatio: 0.6,
        alignment: "center",
      };

      expect(() => calculatePdfCenterCoordinates(placement, 0, 600)).toThrow(
        InvalidNamePlacementError
      );
      expect(() => calculatePdfCenterCoordinates(placement, 800, -100)).toThrow(
        InvalidNamePlacementError
      );
      expect(() => calculatePdfCenterCoordinates(placement, NaN, 600)).toThrow(
        InvalidNamePlacementError
      );
    });

    it("rejects invalid placement coordinates exceeding bounds", () => {
      const invalidPlacement = {
        xRatio: 0.05, // Violates xRatio >= maxWidthRatio / 2 (0.35)
        yRatio: 0.5,
        maxWidthRatio: 0.7,
        alignment: "center",
      } as NamePlacement;

      expect(() => calculatePdfCenterCoordinates(invalidPlacement, 800, 600)).toThrow(
        InvalidNamePlacementError
      );
    });
  });

  describe("calculateBaselineY (Typographic Box Centering)", () => {
    it("centers symmetric font box exactly at centerY", () => {
      // If ascent === descent (e.g. 10 and 10), baseline should equal centerY
      const baseline = calculateBaselineY(300, 10, 10);
      expect(baseline).toBe(300);
    });

    it("correctly offsets baseline when ascent exceeds descent", () => {
      // ascent = 16, descent = 4 -> center offset = (16 - 4)/2 = 6
      // baseline = 300 - 6 = 294
      // Top = 294 + 16 = 310
      // Bottom = 294 - 4 = 290
      // Box center = (310 + 290) / 2 = 300
      const baseline = calculateBaselineY(300, 16, 4);
      expect(baseline).toBe(294);
    });
  });

  describe("calculateStartX & checkTextFits", () => {
    it("centers text horizontally around centerX", () => {
      const startX = calculateStartX(400, 200);
      expect(startX).toBe(300);
    });

    it("checks whether text width fits within maxWidth", () => {
      expect(checkTextFits(200, 250)).toBe(true);
      expect(checkTextFits(250, 250)).toBe(true);
      expect(checkTextFits(250.0001, 250)).toBe(true); // Within floating tolerance
      expect(checkTextFits(251, 250)).toBe(false);
    });
  });

  describe("calculateImagePdfDimensions (DPI Policy)", () => {
    it("uses 300 DPI technical fallback when source density is missing/undefined", () => {
      const res = calculateImagePdfDimensions(1200, 600, undefined);
      expect(res.effectiveDpi).toBe(300);
      expect(res.isFallbackDpi).toBe(true);
      // points = pixels * 72 / 300
      expect(res.pageWidth).toBe((1200 * 72) / 300); // 288
      expect(res.pageHeight).toBe((600 * 72) / 300); // 144
    });

    it("uses actual valid source density when present in [72, 1200]", () => {
      const res = calculateImagePdfDimensions(1500, 1000, 150);
      expect(res.effectiveDpi).toBe(150);
      expect(res.isFallbackDpi).toBe(false);
      expect(res.pageWidth).toBe((1500 * 72) / 150); // 720
      expect(res.pageHeight).toBe((1000 * 72) / 150); // 480
    });

    it("respects custom fallbackDpi parameter when density is missing", () => {
      const res = calculateImagePdfDimensions(1200, 800, null, 150);
      expect(res.effectiveDpi).toBe(150);
      expect(res.isFallbackDpi).toBe(true);
      expect(res.pageWidth).toBe((1200 * 72) / 150);
    });

    it("rejects out-of-range fallback DPI (< 72 or > 1200)", () => {
      expect(() => calculateImagePdfDimensions(1200, 800, undefined, 50)).toThrow(
        UnsupportedTemplateGeometryError
      );
      expect(() => calculateImagePdfDimensions(1200, 800, undefined, 2000)).toThrow(
        UnsupportedTemplateGeometryError
      );
    });

    it("rejects non-positive pixel dimensions", () => {
      expect(() => calculateImagePdfDimensions(0, 800)).toThrow(
        UnsupportedTemplateGeometryError
      );
      expect(() => calculateImagePdfDimensions(800, -10)).toThrow(
        UnsupportedTemplateGeometryError
      );
    });
  });

  describe("validatePdfPageGeometry (Strict Guardrails)", () => {
    it("accepts single-page PDF with 0 rotation, matching CropBox/MediaBox (zero or non-zero origin)", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);

      // Function now returns PdfCropBox instead of void
      expect(() => validatePdfPageGeometry(page)).not.toThrow();
      const box = validatePdfPageGeometry(page);
      expect(box.width).toBeCloseTo(842, 1);
      expect(box.height).toBeCloseTo(595, 1);
    });

    it("rejects PDF page with non-zero rotation", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      page.setRotation(degrees(90));

      expect(() => validatePdfPageGeometry(page)).toThrow(UnsupportedTemplateGeometryError);
      expect(() => validatePdfPageGeometry(page)).toThrow(/non-zero rotation/);
    });

    it("rejects PDF page where CropBox and MediaBox have different dimensions (CropBox != MediaBox)", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      // CropBox (50, 50, 742, 495) has a different origin AND size than MediaBox (0, 0, 842, 595)
      page.setCropBox(50, 50, 742, 495);

      expect(() => validatePdfPageGeometry(page)).toThrow(UnsupportedTemplateGeometryError);
      expect(() => validatePdfPageGeometry(page)).toThrow(/CropBox.*does not match MediaBox/);
    });

    it("rejects PDF page where CropBox does not match MediaBox", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      page.setCropBox(0, 0, 800, 500); // Differs from 842x595

      expect(() => validatePdfPageGeometry(page)).toThrow(UnsupportedTemplateGeometryError);
    });

    it("rejects PDF page with non-default UserUnit", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2.0));

      expect(() => validatePdfPageGeometry(page)).toThrow(UnsupportedTemplateGeometryError);
      expect(() => validatePdfPageGeometry(page)).toThrow(/non-default UserUnit \(2\)/);
    });
  });

  describe("Two-Line Baselines & Vertical Safety Helpers", () => {
    it("calculates symmetric two-line baselines around centerYFromBottom", () => {
      // Ascent: 16, Descent: 4, centerYFromBottom: 300, lineHeight: 24
      // metricOffset: (16 - 4) / 2 = 6
      // baseline1: 300 + 12 - 6 = 306
      // baseline2: 300 - 12 - 6 = 282
      const result = calculateTwoLineBaselines(300, 16, 4, 24);
      expect(result.baseline1).toBe(306);
      expect(result.baseline2).toBe(282);
      expect(result.baseline1 - result.baseline2).toBe(24);
    });

    it("detects typographic line box overlap when lineHeight < ascent + descent", () => {
      // Ascent: 16, Descent: 4 -> totalHeight: 20
      // Baseline separation 18 < 20 -> overlap!
      const { baseline1, baseline2 } = calculateTwoLineBaselines(300, 16, 4, 18);
      expect(checkTwoLineBoxesOverlap(baseline1, baseline2, 16, 4)).toBe(true);

      // Baseline separation 24 >= 20 -> no overlap
      const safe = calculateTwoLineBaselines(300, 16, 4, 24);
      expect(checkTwoLineBoxesOverlap(safe.baseline1, safe.baseline2, 16, 4)).toBe(false);
    });

    it("validates vertical page safety within [0, pageHeight]", () => {
      expect(checkVerticalPageSafety(500, 10, 600)).toBe(true);
      expect(checkVerticalPageSafety(601, 10, 600)).toBe(false); // top exceeds pageHeight
      expect(checkVerticalPageSafety(500, -5, 600)).toBe(false); // bottom drops below 0
    });
  });

  describe("validateRenderStyle (Explicit Inputs)", () => {
    it("accepts valid explicit style with minFontSize and lineHeightMultiplier", () => {
      expect(() =>
        validateRenderStyle({
          fontSize: 28,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0.1, g: 0.2, b: 0.3 },
          stepSize: 1.0,
        })
      ).not.toThrow();

      // Test exact minFontSize === fontSize
      expect(() =>
        validateRenderStyle({
          fontSize: 24,
          minFontSize: 24,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).not.toThrow();
    });

    it("rejects minFontSize > fontSize", () => {
      expect(() =>
        validateRenderStyle({
          fontSize: 20,
          minFontSize: 24,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);
      expect(() =>
        validateRenderStyle({
          fontSize: 20,
          minFontSize: 24,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(/cannot be greater than fontSize/);
    });

    it("rejects non-positive or non-finite minFontSize", () => {
      expect(() =>
        validateRenderStyle({
          fontSize: 28,
          minFontSize: 0,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);

      expect(() =>
        validateRenderStyle({
          fontSize: 28,
          minFontSize: -5,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);
    });

    it("rejects non-positive or non-finite lineHeightMultiplier", () => {
      expect(() =>
        validateRenderStyle({
          fontSize: 28,
          minFontSize: 16,
          lineHeightMultiplier: 0,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);

      expect(() =>
        validateRenderStyle({
          fontSize: 28,
          minFontSize: 16,
          lineHeightMultiplier: -1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);

      expect(() =>
        validateRenderStyle({
          fontSize: 28,
          minFontSize: 16,
          lineHeightMultiplier: NaN,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);
    });

    it("rejects non-positive or non-finite stepSize", () => {
      expect(() =>
        validateRenderStyle({
          fontSize: 28,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          stepSize: 0,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);

      expect(() =>
        validateRenderStyle({
          fontSize: 28,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          stepSize: -1,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);
    });

    it("rejects non-positive or non-finite fontSize", () => {
      expect(() =>
        validateRenderStyle({
          fontSize: 0,
          minFontSize: 0,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);

      expect(() =>
        validateRenderStyle({
          fontSize: -10,
          minFontSize: -20,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);

      expect(() =>
        validateRenderStyle({
          fontSize: NaN,
          minFontSize: 10,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);
    });

    it("rejects RGB color channels outside [0.0, 1.0]", () => {
      expect(() =>
        validateRenderStyle({
          fontSize: 24,
          minFontSize: 12,
          lineHeightMultiplier: 1.2,
          textColor: { r: 255, g: 0, b: 0 }, // Unnormalized 0-255 instead of 0-1
        })
      ).toThrow(InvalidRenderStyleError);

      expect(() =>
        validateRenderStyle({
          fontSize: 24,
          minFontSize: 12,
          lineHeightMultiplier: 1.2,
          textColor: { r: -0.1, g: 0, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);

      expect(() =>
        validateRenderStyle({
          fontSize: 24,
          minFontSize: 12,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0.5, g: 1.1, b: 0 },
        })
      ).toThrow(InvalidRenderStyleError);
    });
  });
});
