import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { PDFDocument, degrees } from "pdf-lib";
import sharp from "sharp";
import { TemplateFileType } from "@/generated/prisma/client";
import { NamePlacement } from "@/lib/coordinates";
import {
  renderSingleCertificate,
  RenderCertificateInput,
} from "@/lib/rendering/engine";
import {
  NameDoesNotFitError,
  UnsupportedTemplateGeometryError,
  TemplateRenderError,
} from "@/lib/rendering/errors";

const TEST_FONT_PATH = path.join(process.cwd(), "tests/fixtures/fonts/test-font.ttf");

describe("Single Certificate Rendering Engine", () => {
  let fontBytes: Buffer;
  let validPdfBytes: Buffer;
  let validPngNoDensityBytes: Buffer;
  let validPngWithDensityBytes: Buffer;
  let validJpgBytes: Buffer;

  const standardPlacement: NamePlacement = {
    xRatio: 0.5,
    yRatio: 0.5,
    maxWidthRatio: 0.7,
    alignment: "center",
  };

  const standardStyle = {
    fontSize: 28,
    minFontSize: 16,
    lineHeightMultiplier: 1.2,
    textColor: { r: 0.1, g: 0.1, b: 0.1 },
  };

  beforeAll(async () => {
    fontBytes = fs.readFileSync(TEST_FONT_PATH);

    // 1. Single page A4 landscape PDF fixture (842 x 595)
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]);
    const pdfData = await doc.save();
    validPdfBytes = Buffer.from(pdfData);

    // 2. PNG fixture without density metadata (default)
    validPngNoDensityBytes = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 4,
        background: { r: 240, g: 240, b: 245, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    // 3. PNG fixture with explicit 150 DPI density
    validPngWithDensityBytes = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 4,
        background: { r: 240, g: 240, b: 245, alpha: 1 },
      },
    })
      .withMetadata({ density: 150 })
      .png()
      .toBuffer();

    // 4. JPG fixture
    validJpgBytes = await sharp({
      create: {
        width: 1000,
        height: 700,
        channels: 3,
        background: { r: 250, g: 248, b: 245 },
      },
    })
      .jpeg()
      .toBuffer();
  });

  describe("PDF Template Rendering", () => {
    it("renders valid single-page PDF certificate preserving template dimensions", async () => {
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: validPdfBytes,
          pageWidth: 842,
          pageHeight: 595,
        },
        placement: standardPlacement,
        participant: {
          name: "  Naufal   Nabil  Ramadhan  ",
        },
        font: {
          fontBytes,
          fontFamily: "LiberationSans",
        },
        style: standardStyle,
      };

      const result = await renderSingleCertificate(input);

      expect(result.renderedName).toBe("Naufal Nabil Ramadhan");
      expect(result.pageWidth).toBe(842);
      expect(result.pageHeight).toBe(595);
      expect(result.fontSize).toBe(28);
      expect(result.textWidth).toBeGreaterThan(0);
      expect(result.pdfBytes).toBeInstanceOf(Uint8Array);

      // Verify serialized output is a valid 1-page PDF
      const outputDoc = await PDFDocument.load(result.pdfBytes);
      expect(outputDoc.getPageCount()).toBe(1);
      const outPage = outputDoc.getPage(0);
      expect(outPage.getSize().width).toBe(842);
      expect(outPage.getSize().height).toBe(595);
    });

    it("rejects PDF with non-zero rotation angle", async () => {
      const rotatedDoc = await PDFDocument.create();
      const page = rotatedDoc.addPage([842, 595]);
      page.setRotation(degrees(90));
      const rotatedBytes = await rotatedDoc.save();

      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: Buffer.from(rotatedBytes),
        },
        placement: standardPlacement,
        participant: { name: "Budi Santoso" },
        font: { fontBytes },
        style: standardStyle,
      };

      await expect(renderSingleCertificate(input)).rejects.toThrow(
        UnsupportedTemplateGeometryError
      );
    });

    it("rejects multi-page PDF templates", async () => {
      const multiDoc = await PDFDocument.create();
      multiDoc.addPage([600, 400]);
      multiDoc.addPage([600, 400]);
      const multiBytes = await multiDoc.save();

      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: Buffer.from(multiBytes),
        },
        placement: standardPlacement,
        participant: { name: "Budi Santoso" },
        font: { fontBytes },
        style: standardStyle,
      };

      await expect(renderSingleCertificate(input)).rejects.toThrow(
        TemplateRenderError
      );
    });

    it("rejects corrupt PDF template bytes", async () => {
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: Buffer.from("NOT_A_VALID_PDF_BYTE_STREAM"),
        },
        placement: standardPlacement,
        participant: { name: "Budi Santoso" },
        font: { fontBytes },
        style: standardStyle,
      };

      await expect(renderSingleCertificate(input)).rejects.toThrow(
        TemplateRenderError
      );
    });
  });

  describe("PNG & JPG Template Rendering", () => {
    it("renders PNG template using 300 DPI fallback when density is missing", async () => {
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PNG,
          sourceBytes: validPngNoDensityBytes,
        },
        placement: standardPlacement,
        participant: { name: "Siti Rahmawati" },
        font: { fontBytes },
        style: standardStyle,
      };

      const result = await renderSingleCertificate(input);

      // 1200 x 800 at 300 DPI -> 288 x 192 pt
      expect(result.pageWidth).toBeCloseTo((1200 * 72) / 300, 2);
      expect(result.pageHeight).toBeCloseTo((800 * 72) / 300, 2);

      const outputDoc = await PDFDocument.load(result.pdfBytes);
      expect(outputDoc.getPageCount()).toBe(1);
    });

    it("renders PNG template using source density when valid density is present", async () => {
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PNG,
          sourceBytes: validPngWithDensityBytes,
        },
        placement: standardPlacement,
        participant: { name: "Siti Rahmawati" },
        font: { fontBytes },
        style: standardStyle,
      };

      const result = await renderSingleCertificate(input);

      // 1200 x 800 at 150 DPI -> 576 x 384 pt
      expect(result.pageWidth).toBeCloseTo((1200 * 72) / 150, 2);
      expect(result.pageHeight).toBeCloseTo((800 * 72) / 150, 2);
    });

    it("renders JPG template to single-page PDF", async () => {
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.JPG,
          sourceBytes: validJpgBytes,
        },
        placement: standardPlacement,
        participant: { name: "Ahmad Dahlan" },
        font: { fontBytes },
        style: standardStyle,
      };

      const result = await renderSingleCertificate(input);

      // Sharp/libjpeg encodes 72 DPI by default into JFIF headers; engine respects actual density
      expect(result.pageWidth).toBeCloseTo((1000 * 72) / 72, 2);
      expect(result.pageHeight).toBeCloseTo((700 * 72) / 72, 2);

      const outputDoc = await PDFDocument.load(result.pdfBytes);
      expect(outputDoc.getPageCount()).toBe(1);
    });

    it("rejects image template with non-standard EXIF orientation (2..8)", async () => {
      const orientedBytes = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 200, g: 200, b: 200 },
        },
      })
        .withMetadata({ orientation: 6 }) // 90° CW
        .jpeg()
        .toBuffer();

      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.JPG,
          sourceBytes: orientedBytes,
        },
        placement: standardPlacement,
        participant: { name: "Ahmad Dahlan" },
        font: { fontBytes },
        style: standardStyle,
      };

      await expect(renderSingleCertificate(input)).rejects.toThrow(
        UnsupportedTemplateGeometryError
      );
      await expect(renderSingleCertificate(input)).rejects.toThrow(
        /non-standard EXIF orientation \(6\)/
      );
    });
  });

  describe("Overflow Gate (Strict Phase 7 Policy)", () => {
    it("fails with NameDoesNotFitError when text width exceeds maxWidth at given fontSize", async () => {
      // Very long name with large font size that is guaranteed to exceed maxWidth
      const longName = "Prof. Dr. Ir. Raden Mas Panji Sosrokartono Kusumoyudo Hardjodiningrat";
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: validPdfBytes,
        },
        placement: {
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.3, // Usable width: 0.3 * 842 = 252.6 pt
          alignment: "center",
        },
        participant: { name: longName },
        font: { fontBytes },
        style: {
          fontSize: 36,
          minFontSize: 36,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      };

      let caughtError: unknown;
      try {
        await renderSingleCertificate(input);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(NameDoesNotFitError);
      const fitErr = caughtError as NameDoesNotFitError;
      expect(fitErr.textWidth).toBeGreaterThan(fitErr.maxWidth);
      expect(fitErr.name).toBe(longName);
      expect(fitErr.fontSize).toBe(36);
      expect(fitErr.reason).toBe("TWO_LINE_OVERFLOW");
    });
  });

  describe("Input Safety & Normalization", () => {
    it("rejects empty or whitespace-only participant names", async () => {
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: validPdfBytes,
        },
        placement: standardPlacement,
        participant: { name: "    " },
        font: { fontBytes },
        style: standardStyle,
      };

      await expect(renderSingleCertificate(input)).rejects.toThrow(
        TemplateRenderError
      );
    });

    it("rejects empty template source bytes", async () => {
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: Buffer.alloc(0),
        },
        placement: standardPlacement,
        participant: { name: "Budi" },
        font: { fontBytes },
        style: standardStyle,
      };

      await expect(renderSingleCertificate(input)).rejects.toThrow(
        TemplateRenderError
      );
    });
  });

  describe("Source Immutability & Determinism", () => {
    it("does not mutate the source template buffer", async () => {
      const originalCopy = Buffer.from(validPdfBytes);

      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: validPdfBytes,
        },
        placement: standardPlacement,
        participant: { name: "Budi Santoso" },
        font: { fontBytes },
        style: standardStyle,
      };

      await renderSingleCertificate(input);

      expect(validPdfBytes.equals(originalCopy)).toBe(true);
    });

    it("produces semantically and visually equivalent results for identical inputs", async () => {
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: validPdfBytes,
        },
        placement: standardPlacement,
        participant: { name: "Budi Santoso" },
        font: { fontBytes },
        style: standardStyle,
      };

      const res1 = await renderSingleCertificate(input);
      const res2 = await renderSingleCertificate(input);

      expect(res1.pageWidth).toBe(res2.pageWidth);
      expect(res1.pageHeight).toBe(res2.pageHeight);
      expect(res1.renderedName).toBe(res2.renderedName);
      expect(res1.fontSize).toBe(res2.fontSize);
      expect(res1.textWidth).toBe(res2.textWidth);
      expect(res1.baselineY).toBe(res2.baselineY);
    });
  });

  describe("Visual Correctness QA via PDF.js", () => {
    it("verifies participant name text is extractable and rendered by PDF.js", async () => {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: validPdfBytes,
        },
        placement: standardPlacement,
        participant: { name: "Naufal Nabil Ramadhan" },
        font: { fontBytes },
        style: standardStyle,
      };

      const result = await renderSingleCertificate(input);

      // Load with PDF.js in Node environment
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(result.pdfBytes),
        useSystemFonts: true,
      });
      const pdfDoc = await loadingTask.promise;

      expect(pdfDoc.numPages).toBe(1);
      const page = await pdfDoc.getPage(1);
      const textContent = await page.getTextContent();

      const strings = textContent.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => item.str)
        .filter(Boolean);

      const combinedText = strings.join(" ");
      expect(combinedText).toContain("Naufal Nabil Ramadhan");
    }, 30000);

    it("automatically shrinks font size on PDF template when needed", async () => {
      const name = "Muhammad Naufal Nabil Ramadhan";
      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: validPdfBytes,
        },
        placement: {
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.4, // Forces shrink
          alignment: "center",
        },
        participant: { name },
        font: { fontBytes },
        style: {
          fontSize: 36,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0.1, g: 0.1, b: 0.1 },
        },
      };

      const result = await renderSingleCertificate(input);
      expect(result.layoutPlan.mode).toBe("single-line");
      expect(result.fontSize).toBeLessThan(36);
      expect(result.fontSize).toBeGreaterThanOrEqual(16);
      expect(result.renderedName).toBe(name);
    });

    it("automatically wraps long participant name to two lines on PDF and extracts both lines in order via PDF.js", async () => {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const longName = "Prof. Dr. Ir. Muhammad Naufal Nabil Ramadhan, M.Kom., Ph.D.";

      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PDF,
          sourceBytes: validPdfBytes,
        },
        placement: {
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.35, // Forces two-line wrap
          alignment: "center",
        },
        participant: { name: longName },
        font: { fontBytes },
        style: {
          fontSize: 32,
          minFontSize: 14,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0.1, g: 0.1, b: 0.1 },
        },
      };

      const result = await renderSingleCertificate(input);

      expect(result.layoutPlan.mode).toBe("two-line");
      if (result.layoutPlan.mode === "two-line") {
        expect(result.layoutPlan.lines.length).toBe(2);
        const [line1, line2] = result.layoutPlan.lines;
        expect(`${line1.text} ${line2.text}`).toBe(longName);
        expect(line1.baselineY).toBeGreaterThan(line2.baselineY);
      }

      // Verify with PDF.js text extraction
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(result.pdfBytes),
        useSystemFonts: true,
      });
      const pdfDoc = await loadingTask.promise;
      const page = await pdfDoc.getPage(1);
      const textContent = await page.getTextContent();
      const strings = textContent.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => item.str)
        .filter(Boolean);

      const combinedText = strings.join(" ");
      expect(combinedText).toContain("Prof. Dr. Ir. Muhammad");
      expect(combinedText).toContain("Ramadhan, M.Kom., Ph.D.");
    }, 30000);

    it("automatically wraps long participant name to two lines on PNG template", async () => {
      const longName = "Prof. Dr. Ir. Muhammad Naufal Nabil Ramadhan, M.Kom., Ph.D.";

      const input: RenderCertificateInput = {
        template: {
          fileType: TemplateFileType.PNG,
          sourceBytes: validPngWithDensityBytes,
        },
        placement: {
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.6, // Single line at 32pt (~800pt) overflows 345.6pt, wraps to two lines
          alignment: "center",
        },
        participant: { name: longName },
        font: { fontBytes },
        style: {
          fontSize: 32,
          minFontSize: 14,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0.1, g: 0.1, b: 0.1 },
        },
      };

      const result = await renderSingleCertificate(input);
      expect(result.layoutPlan.mode).toBe("two-line");
      expect(result.pdfBytes.byteLength).toBeGreaterThan(1000);
    });
  });
});
