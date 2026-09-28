import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFNumber, degrees } from "pdf-lib";
import {
  validatePdfPageGeometry,
  calculatePdfCenterCoordinates,
  checkVerticalPageSafety,
  calculateStartX,
  type PdfCropBox,
} from "@/lib/rendering/geometry";
import {
  UnsupportedTemplateGeometryError,
} from "@/lib/rendering/errors";
import type { NamePlacement } from "@/lib/coordinates";

describe("PDF CropBox origin support", () => {
  // -----------------------------------------------------------------
  // validatePdfPageGeometry: accepts non-zero origins
  // -----------------------------------------------------------------
  describe("validatePdfPageGeometry", () => {
    it("regression: accepts zero-origin page and returns correct CropBox", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      const box: PdfCropBox = validatePdfPageGeometry(page);
      expect(box.x).toBeCloseTo(0, 4);
      expect(box.y).toBeCloseTo(0, 4);
      expect(box.width).toBeCloseTo(842, 1);
      expect(box.height).toBeCloseTo(595, 1);
    });

    it("accepts page with matching non-zero Y origin (real-world CropBox.y = 8.58)", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842.25, 604.08]);
      page.setMediaBox(0, 8.58, 842.25, 586.92);
      page.setCropBox(0, 8.58, 842.25, 586.92);
      const box: PdfCropBox = validatePdfPageGeometry(page);
      expect(box.x).toBeCloseTo(0, 2);
      expect(box.y).toBeCloseTo(8.58, 2);
      expect(box.width).toBeCloseTo(842.25, 1);
      expect(box.height).toBeCloseTo(586.92, 1);
    });

    it("accepts page with non-zero X and Y origin", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([900, 700]);
      page.setMediaBox(10, 20, 880, 660);
      page.setCropBox(10, 20, 880, 660);
      const box: PdfCropBox = validatePdfPageGeometry(page);
      expect(box.x).toBeCloseTo(10, 2);
      expect(box.y).toBeCloseTo(20, 2);
    });

    it("still rejects non-zero rotation", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      page.setRotation(degrees(90));
      expect(() => validatePdfPageGeometry(page)).toThrow(UnsupportedTemplateGeometryError);
    });

    it("still rejects CropBox that does not match MediaBox", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      page.setCropBox(0, 0, 800, 500);
      expect(() => validatePdfPageGeometry(page)).toThrow(UnsupportedTemplateGeometryError);
    });

    it("still rejects CropBox with different origin than MediaBox", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      page.setMediaBox(0, 0, 842, 595);
      page.setCropBox(10, 0, 832, 595);
      expect(() => validatePdfPageGeometry(page)).toThrow(UnsupportedTemplateGeometryError);
    });

    it("still rejects non-default UserUnit", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([842, 595]);
      page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2.0));
      expect(() => validatePdfPageGeometry(page)).toThrow(UnsupportedTemplateGeometryError);
    });
  });

  // -----------------------------------------------------------------
  // calculatePdfCenterCoordinates: CropBox origin offset
  // -----------------------------------------------------------------
  describe("calculatePdfCenterCoordinates with cropBoxOrigin", () => {
    it("zero-origin behaves identically to old single-argument form", () => {
      const placement: NamePlacement = {
        xRatio: 0.5, yRatio: 0.4, maxWidthRatio: 0.8, alignment: "center",
      };
      const r = calculatePdfCenterCoordinates(placement, 800, 600);
      expect(r.centerX).toBe(400);
      expect(r.centerYFromBottom).toBe(360);
      expect(r.maxWidth).toBe(640);
    });

    it("non-zero Y origin offsets centerYFromBottom correctly", () => {
      const placement: NamePlacement = {
        xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.7, alignment: "center",
      };
      // CropBox: x=0, y=8.58, w=842.25, h=586.92
      const r = calculatePdfCenterCoordinates(placement, 842.25, 586.92, { x: 0, y: 8.58 });
      // centerX = 0 + 0.5 * 842.25 = 421.125
      expect(r.centerX).toBeCloseTo(421.125, 2);
      // centerYFromBottom = 8.58 + (1 - 0.5) * 586.92 = 8.58 + 293.46 = 302.04
      expect(r.centerYFromBottom).toBeCloseTo(302.04, 1);
      expect(r.maxWidth).toBeCloseTo(842.25 * 0.7, 2);
    });

    it("non-zero X and Y origin both offset correctly", () => {
      const placement: NamePlacement = {
        xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.6, alignment: "left",
      };
      const r = calculatePdfCenterCoordinates(placement, 880, 660, { x: 10, y: 20 });
      expect(r.centerX).toBeCloseTo(450, 2);       // 10 + 0.5*880
      expect(r.centerYFromBottom).toBeCloseTo(350, 2); // 20 + 0.5*660
    });

    it("center alignment: startX centers text around centerX from origin", () => {
      const centerX = 450;
      const textWidth = 300;
      const maxWidth = 528; // 0.6 * 880
      const startX = calculateStartX(centerX, textWidth, maxWidth, "center");
      // center: centerX - textWidth/2 = 450 - 150 = 300
      expect(startX).toBeCloseTo(300, 2);
    });

    it("left alignment: startX is left edge of the box", () => {
      const startX = calculateStartX(450, 300, 528, "left");
      // centerX - maxWidth/2 = 450 - 264 = 186
      expect(startX).toBeCloseTo(186, 2);
    });

    it("right alignment: startX is right edge minus text width", () => {
      const startX = calculateStartX(450, 300, 528, "right");
      // centerX + maxWidth/2 - textWidth = 450 + 264 - 300 = 414
      expect(startX).toBeCloseTo(414, 2);
    });
  });

  // -----------------------------------------------------------------
  // checkVerticalPageSafety: non-zero cropBoxY
  // -----------------------------------------------------------------
  describe("checkVerticalPageSafety with non-zero cropBoxY", () => {
    it("zero-origin: same behaviour as before", () => {
      expect(checkVerticalPageSafety(500, 10, 600)).toBe(true);
      expect(checkVerticalPageSafety(601, 10, 600)).toBe(false);
      expect(checkVerticalPageSafety(500, -5, 600)).toBe(false);
    });

    it("non-zero cropBoxY: bounds relative to CropBox bottom and top", () => {
      // CropBox: y=8.58 to y+height=8.58+586.92=595.5
      const cY = 8.58;
      const pH = 586.92;
      expect(checkVerticalPageSafety(595, 50, pH, cY)).toBe(true);     // inside (top 595 < 595.5)
      expect(checkVerticalPageSafety(597, 50, pH, cY)).toBe(false);    // top 597 > cropTop 595.5
      expect(checkVerticalPageSafety(500, 9, pH, cY)).toBe(true);      // bottom >= cY
      expect(checkVerticalPageSafety(500, 7, pH, cY)).toBe(false);     // bottom < cY
    });
  });
});
