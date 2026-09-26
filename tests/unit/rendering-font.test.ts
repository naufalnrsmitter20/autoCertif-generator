import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import {
  embedCustomFont,
  validateFontGlyphSupport,
  measureText,
} from "@/lib/rendering/font";
import {
  FontNotConfiguredError,
  FontUnsupportedGlyphError,
  CertificateRenderError,
} from "@/lib/rendering/errors";

const TEST_FONT_PATH = path.join(process.cwd(), "tests/fixtures/fonts/test-font.ttf");

describe("Rendering Font & Glyph Safety", () => {
  const fontBytes = fs.readFileSync(TEST_FONT_PATH);

  describe("embedCustomFont", () => {
    it("embeds valid TTF font asset using fontkit", async () => {
      const doc = await PDFDocument.create();
      const font = await embedCustomFont(doc, fontBytes, "LiberationSans");

      expect(font).toBeDefined();
      expect(font.name).toBe("LiberationSans");
      expect(font.getCharacterSet().length).toBeGreaterThan(100);
    });

    it("throws FontNotConfiguredError when font bytes are empty", async () => {
      const doc = await PDFDocument.create();
      await expect(
        embedCustomFont(doc, new Uint8Array(0), "LiberationSans")
      ).rejects.toThrow(FontNotConfiguredError);
    });

    it("throws CertificateRenderError when font bytes are corrupt", async () => {
      const doc = await PDFDocument.create();
      const corruptBytes = Buffer.from("NOT_A_TRUE_TYPE_FONT_DATA");

      await expect(
        embedCustomFont(doc, corruptBytes, "CorruptFont")
      ).rejects.toThrow(CertificateRenderError);
    });
  });

  describe("validateFontGlyphSupport (Full Unicode Code Points)", () => {
    it("accepts standard ASCII names", async () => {
      const doc = await PDFDocument.create();
      const font = await embedCustomFont(doc, fontBytes);

      expect(() =>
        validateFontGlyphSupport(font, "Naufal Nabil Ramadhan")
      ).not.toThrow();

      expect(() =>
        validateFontGlyphSupport(font, "John Doe, Jr. (Ph.D.) - 2026")
      ).not.toThrow();
    });

    it("accepts supported accented Latin characters in LiberationSans", async () => {
      const doc = await PDFDocument.create();
      const font = await embedCustomFont(doc, fontBytes);

      expect(() =>
        validateFontGlyphSupport(font, "René Descartes")
      ).not.toThrow();

      expect(() =>
        validateFontGlyphSupport(font, "François Müller")
      ).not.toThrow();
    });

    it("throws FontUnsupportedGlyphError on unsupported CJK characters", async () => {
      const doc = await PDFDocument.create();
      const font = await embedCustomFont(doc, fontBytes, "LiberationSans");

      let caughtError: unknown;
      try {
        validateFontGlyphSupport(font, "Naufal 世界");
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(FontUnsupportedGlyphError);
      const glyphErr = caughtError as FontUnsupportedGlyphError;
      expect(glyphErr.char).toBe("世");
      expect(glyphErr.codePoint).toBe(0x4e16);
      expect(glyphErr.message).toContain('does not support character "世" (U+4E16)');
    });

    it("throws FontUnsupportedGlyphError on 32-bit surrogate pair emojis", async () => {
      const doc = await PDFDocument.create();
      const font = await embedCustomFont(doc, fontBytes, "LiberationSans");

      let caughtError: unknown;
      try {
        validateFontGlyphSupport(font, "Alice 🎉");
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(FontUnsupportedGlyphError);
      const glyphErr = caughtError as FontUnsupportedGlyphError;
      expect(glyphErr.char).toBe("🎉");
      expect(glyphErr.codePoint).toBe(0x1f389);
      expect(glyphErr.message).toContain('does not support character "🎉" (U+1F389)');
    });
  });

  describe("measureText (Font Metrics)", () => {
    it("measures accurate text width and typographic box height", async () => {
      const doc = await PDFDocument.create();
      const font = await embedCustomFont(doc, fontBytes);

      const metricsShort = measureText(font, "Budi", 24);
      const metricsLong = measureText(font, "Budi Santoso Sudirman", 24);

      expect(metricsShort.textWidth).toBeGreaterThan(0);
      expect(metricsLong.textWidth).toBeGreaterThan(metricsShort.textWidth);

      // Total height should equal ascent + descent
      expect(metricsShort.totalHeight).toBeCloseTo(
        metricsShort.ascent + metricsShort.descent,
        4
      );

      // Metrics at size 48 should be double size 24
      const metricsDouble = measureText(font, "Budi", 48);
      expect(metricsDouble.textWidth).toBeCloseTo(metricsShort.textWidth * 2, 1);
      expect(metricsDouble.totalHeight).toBeCloseTo(metricsShort.totalHeight * 2, 1);
    });
  });
});
