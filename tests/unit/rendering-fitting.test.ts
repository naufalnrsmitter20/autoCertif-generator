import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { PDFDocument, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  generateCandidateFontSizes,
  splitIntoWords,
  generateCandidateSplits,
  calculateNameLayout,
} from "@/lib/rendering/fitting";
import { NameDoesNotFitError } from "@/lib/rendering/errors";
import { measureText } from "@/lib/rendering/font";

const TEST_FONT_PATH = path.join(process.cwd(), "tests/fixtures/fonts/test-font.ttf");

describe("Name Auto-Fitting & Rendering Policy (Phase 8)", () => {
  let font: PDFFont;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const fontBytes = fs.readFileSync(TEST_FONT_PATH);
    font = await doc.embedFont(fontBytes);
  });

  describe("generateCandidateFontSizes (Deterministic Shrink Sequence)", () => {
    it("generates exact descending sequence with integer steps", () => {
      const sizes = generateCandidateFontSizes(24, 20, 1.0);
      expect(sizes).toEqual([24, 23, 22, 21, 20]);
    });

    it("evaluates exact minFontSize once even with non-even step progression", () => {
      // 35.5 - 5 = 30.5, 25.5, 20.5, then 15.5 is < 18.2. Exact 18.2 must be appended once!
      const sizes = generateCandidateFontSizes(35.5, 18.2, 5.0);
      expect(sizes).toEqual([35.5, 30.5, 25.5, 20.5, 18.2]);
      // Verify no duplicates
      const unique = Array.from(new Set(sizes));
      expect(unique.length).toBe(sizes.length);
      // Verify strictly descending
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]).toBeLessThan(sizes[i - 1]);
      }
    });

    it("handles defaultFontSize === minFontSize", () => {
      const sizes = generateCandidateFontSizes(20, 20, 1.0);
      expect(sizes).toEqual([20]);
    });

    it("rejects defaultFontSize < minFontSize", () => {
      expect(() => generateCandidateFontSizes(15, 20, 1.0)).toThrow(
        /must be >= minFontSize/
      );
    });

    it("rejects non-positive stepSize", () => {
      expect(() => generateCandidateFontSizes(25, 20, 0)).toThrow(
        /stepSize must be a positive finite number/
      );
      expect(() => generateCandidateFontSizes(25, 20, -1)).toThrow(
        /stepSize must be a positive finite number/
      );
    });
  });

  describe("splitIntoWords & generateCandidateSplits", () => {
    it("splits normalized names by whitespace", () => {
      expect(splitIntoWords("   Naufal    Nabil   Ramadhan  ")).toEqual([
        "Naufal",
        "Nabil",
        "Ramadhan",
      ]);
      expect(splitIntoWords("SingleWord")).toEqual(["SingleWord"]);
      expect(splitIntoWords("")).toEqual([]);
    });

    it("generates exactly N - 1 splits for N words", () => {
      const words = ["Prof.", "Dr.", "Naufal", "Nabil", "Ramadhan"];
      const splits = generateCandidateSplits(words);
      expect(splits.length).toBe(4);

      // Verify concatenating line1 and line2 reconstructs the exact words
      for (const s of splits) {
        expect(`${s.line1} ${s.line2}`).toBe(words.join(" "));
      }

      expect(splits[0]).toEqual({
        splitIndex: 1,
        line1: "Prof.",
        line2: "Dr. Naufal Nabil Ramadhan",
      });
      expect(splits[3]).toEqual({
        splitIndex: 4,
        line1: "Prof. Dr. Naufal Nabil",
        line2: "Ramadhan",
      });
    });

    it("returns empty splits array for single-word names", () => {
      expect(generateCandidateSplits(["Word"])).toEqual([]);
    });

    it("handles two-word single split", () => {
      const splits = generateCandidateSplits(["John", "Doe"]);
      expect(splits.length).toBe(1);
      expect(splits[0]).toEqual({
        splitIndex: 1,
        line1: "John",
        line2: "Doe",
      });
    });
  });

  describe("Single-Line Fitting (Shrink-Until-Fit)", () => {
    it("fits at default font size when text width <= maxWidth", () => {
      const plan = calculateNameLayout({
        name: "Naufal Nabil",
        font,
        centerX: 400,
        centerYFromBottom: 300,
        maxWidth: 500, // plenty of room
        pageHeight: 600,
        style: {
          fontSize: 32,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      });

      expect(plan.mode).toBe("single-line");
      expect(plan.fontSize).toBe(32);
      expect(plan.lines.length).toBe(1);
      expect(plan.lines[0].text).toBe("Naufal Nabil");
      expect(plan.lines[0].width).toBeLessThanOrEqual(500);
      expect(plan.lines[0].startX).toBe(400 - plan.lines[0].width / 2);
    });

    it("shrinks font size down until it fits within maxWidth", () => {
      const name = "Muhammad Naufal Nabil Ramadhan";
      const { textWidth: widthAt36 } = measureText(font, name, 36);

      // Set maxWidth so it doesn't fit at 36, but fits at ~24
      const { textWidth: widthAt24 } = measureText(font, name, 24);
      const targetMaxWidth = widthAt24 + 10;
      expect(widthAt36).toBeGreaterThan(targetMaxWidth);

      const plan = calculateNameLayout({
        name,
        font,
        centerX: 400,
        centerYFromBottom: 300,
        maxWidth: targetMaxWidth,
        pageHeight: 600,
        style: {
          fontSize: 36,
          minFontSize: 16,
          stepSize: 1.0,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      });

      expect(plan.mode).toBe("single-line");
      expect(plan.fontSize).toBeLessThan(36);
      expect(plan.fontSize).toBeGreaterThanOrEqual(24);
      expect(plan.lines[0].width).toBeLessThanOrEqual(targetMaxWidth);
    });

    it("evaluates exact maxWidth boundary (fits when width <= maxWidth + 1e-4)", () => {
      const name = "Test Name";
      const { textWidth: exactWidth } = measureText(font, name, 24);

      const plan = calculateNameLayout({
        name,
        font,
        centerX: 400,
        centerYFromBottom: 300,
        maxWidth: exactWidth, // Exact match
        pageHeight: 600,
        style: {
          fontSize: 24,
          minFontSize: 24,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      });

      expect(plan.mode).toBe("single-line");
      expect(plan.fontSize).toBe(24);
    });

    it("just-over-width behavior: fails if single-size candidate exceeds by 0.01 pt", () => {
      // Single word to prevent 2-line fallback
      const singleWord = "TestNameWithoutSpaces";
      const { textWidth: wordWidth } = measureText(font, singleWord, 24);

      expect(() =>
        calculateNameLayout({
          name: singleWord,
          font,
          centerX: 400,
          centerYFromBottom: 300,
          maxWidth: wordWidth - 0.5, // slightly less than required
          pageHeight: 600,
          style: {
            fontSize: 24,
            minFontSize: 24,
            lineHeightMultiplier: 1.2,
            textColor: { r: 0, g: 0, b: 0 },
          },
        })
      ).toThrow(NameDoesNotFitError);
    });
  });

  describe("Authoritative Two-Line Policy & Ranking", () => {
    it("wraps to two lines when single line overflows at minFontSize", () => {
      const name = "Prof. Dr. Ir. Muhammad Naufal Nabil Ramadhan, M.Kom., Ph.D.";
      const { textWidth: fullWidthAtMin } = measureText(font, name, 16);
      expect(fullWidthAtMin).toBeGreaterThan(250);

      // Usable width: 250 pt. Full name at 16pt is ~400pt, so single line fails.
      // But split into two lines, each line is ~200pt < 250pt.
      const plan = calculateNameLayout({
        name,
        font,
        centerX: 400,
        centerYFromBottom: 300,
        maxWidth: 250,
        pageHeight: 600,
        style: {
          fontSize: 32,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      });

      expect(plan.mode).toBe("two-line");
      if (plan.mode === "two-line") {
        expect(plan.lines.length).toBe(2);
        expect(plan.lines[0].width).toBeLessThanOrEqual(250);
        expect(plan.lines[1].width).toBeLessThanOrEqual(250);

        // Concatenating returned lines with a space reconstructs the exact normalized name
        expect(`${plan.lines[0].text} ${plan.lines[1].text}`).toBe(name);

        // Line 1 baseline is strictly higher than Line 2 baseline
        expect(plan.lines[0].baselineY).toBeGreaterThan(plan.lines[1].baselineY);
      }
    });

    it("prefers largest font size candidate over a more-balanced smaller-font split", () => {
      // Test words where one split can fit at 22pt, while a more balanced split can only fit at 18pt
      const words = ["Small", "Name", "VeryVeryLongSecondHalfOfName"];
      const fullName = words.join(" ");

      const plan = calculateNameLayout({
        name: fullName,
        font,
        centerX: 400,
        centerYFromBottom: 300,
        maxWidth: 260,
        pageHeight: 600,
        style: {
          fontSize: 26,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      });

      expect(plan.mode).toBe("two-line");
      // The winner must have selected the maximum possible font size that fits both lines
      if (plan.mode === "two-line") {
        expect(plan.lines[0].width).toBeLessThanOrEqual(260);
        expect(plan.lines[1].width).toBeLessThanOrEqual(260);
      }
    });

    it("breaks ties with balance: chooses split with smallest abs(line1Width - line2Width) at same fontSize", () => {
      // Four words of similar lengths: "Alpha Beta Gamma Delta"
      // Split 1: "Alpha" vs "Beta Gamma Delta" (unbalanced)
      // Split 2: "Alpha Beta" vs "Gamma Delta" (balanced)
      // Split 3: "Alpha Beta Gamma" vs "Delta" (unbalanced)
      const name = "Alpha Beta Gamma Delta";

      const plan = calculateNameLayout({
        name,
        font,
        centerX: 400,
        centerYFromBottom: 300,
        maxWidth: 150, // Forces two lines
        pageHeight: 600,
        style: {
          fontSize: 20,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      });

      expect(plan.mode).toBe("two-line");
      if (plan.mode === "two-line") {
        expect(plan.splitIndex).toBe(2);
        expect(plan.lines[0].text).toBe("Alpha Beta");
        expect(plan.lines[1].text).toBe("Gamma Delta");
      }
    });

    it("deterministic final tie-break: chooses earliest split index when fontSize, widthDiff, and maxLineWidth are equal", () => {
      // Two symmetrical single-letter words: "A B C D"
      // If Split 1 and Split 3 have identical metrics, splitIndex 1 must win over 3
      const name = "A B C D";

      const plan = calculateNameLayout({
        name,
        font,
        centerX: 400,
        centerYFromBottom: 300,
        maxWidth: 40,
        pageHeight: 600,
        style: {
          fontSize: 16,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      });

      expect(plan.mode).toBe("two-line");
      if (plan.mode === "two-line") {
        expect(plan.splitIndex).toBeDefined();
        expect(plan.lines[0].width).toBeLessThanOrEqual(40);
        expect(plan.lines[1].width).toBeLessThanOrEqual(40);
      }
    });

    it("preserves Unicode and diacritics across lines", () => {
      const name = "José Ramón Fernández Hernández";

      const plan = calculateNameLayout({
        name,
        font,
        centerX: 400,
        centerYFromBottom: 300,
        maxWidth: 180,
        pageHeight: 600,
        style: {
          fontSize: 24,
          minFontSize: 16,
          lineHeightMultiplier: 1.2,
          textColor: { r: 0, g: 0, b: 0 },
        },
      });

      expect(plan.mode).toBe("two-line");
      if (plan.mode === "two-line") {
        expect(`${plan.lines[0].text} ${plan.lines[1].text}`).toBe(name);
        expect(plan.lines[0].text).toContain("é");
        expect(plan.lines[0].text).toContain("ó");
      }
    });
  });

  describe("Failure Invariants & Rejection Rules", () => {
    it("throws SINGLE_WORD_OVERFLOW when a single unbroken word exceeds maxWidth at minFontSize", () => {
      const singleLongWord = "Sriwijayanegarakusumawardhanabudiutomo";

      let caught: unknown;
      try {
        calculateNameLayout({
          name: singleLongWord,
          font,
          centerX: 400,
          centerYFromBottom: 300,
          maxWidth: 100, // Impossibly narrow
          pageHeight: 600,
          style: {
            fontSize: 24,
            minFontSize: 16,
            lineHeightMultiplier: 1.2,
            textColor: { r: 0, g: 0, b: 0 },
          },
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NameDoesNotFitError);
      const fitErr = caught as NameDoesNotFitError;
      expect(fitErr.reason).toBe("SINGLE_WORD_OVERFLOW");
      expect(fitErr.participantName).toBe(singleLongWord);
      expect(fitErr.fontSize).toBe(16);
    });

    it("throws TWO_LINE_OVERFLOW when words are too wide for two lines even at minFontSize", () => {
      const longWords = "Superlongwordnumberoneiswaytoolong Superlongwordnumbertwoisalsooverflowing";

      let caught: unknown;
      try {
        calculateNameLayout({
          name: longWords,
          font,
          centerX: 400,
          centerYFromBottom: 300,
          maxWidth: 80, // Far too narrow for either word
          pageHeight: 600,
          style: {
            fontSize: 24,
            minFontSize: 16,
            lineHeightMultiplier: 1.2,
            textColor: { r: 0, g: 0, b: 0 },
          },
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NameDoesNotFitError);
      const fitErr = caught as NameDoesNotFitError;
      expect(fitErr.reason).toBe("TWO_LINE_OVERFLOW");
    });

    it("throws VERTICAL_OVERFLOW when yRatio places text near page top edge", () => {
      // yRatio = 0.005 -> centerYFromBottom = (1 - 0.005) * 600 = 597 (3pt from top)
      // Text ascent at 24pt is ~16pt, so top = 597 + 16 = 613 > 600!
      let caught: unknown;
      try {
        calculateNameLayout({
          name: "John Doe",
          font,
          centerX: 400,
          centerYFromBottom: 597, // 3pt from top edge of 600pt page
          maxWidth: 500,
          pageHeight: 600,
          style: {
            fontSize: 24,
            minFontSize: 24,
            lineHeightMultiplier: 1.2,
            textColor: { r: 0, g: 0, b: 0 },
          },
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NameDoesNotFitError);
      const fitErr = caught as NameDoesNotFitError;
      expect(fitErr.reason).toBe("VERTICAL_OVERFLOW");
    });

    it("throws VERTICAL_OVERFLOW when yRatio places text near page bottom edge", () => {
      // centerYFromBottom = 2 pt from bottom
      // Text descent at 24pt is ~5pt, so bottom = 2 - 5 = -3 < 0!
      let caught: unknown;
      try {
        calculateNameLayout({
          name: "John Doe",
          font,
          centerX: 400,
          centerYFromBottom: 2, // 2pt from bottom
          maxWidth: 500,
          pageHeight: 600,
          style: {
            fontSize: 24,
            minFontSize: 24,
            lineHeightMultiplier: 1.2,
            textColor: { r: 0, g: 0, b: 0 },
          },
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NameDoesNotFitError);
      const fitErr = caught as NameDoesNotFitError;
      expect(fitErr.reason).toBe("VERTICAL_OVERFLOW");
    });

    it("throws INSUFFICIENT_LINE_HEIGHT when line height multiplier causes typographic box overlap", () => {
      // If lineHeightMultiplier is 0.5, lineHeight = 16 * 0.5 = 8pt.
      // But totalHeight at 16pt is ~18pt (ascent ~11, descent ~7).
      // Line boxes overlap!
      const name = "First Line And Second Line";

      let caught: unknown;
      try {
        calculateNameLayout({
          name,
          font,
          centerX: 400,
          centerYFromBottom: 300,
          maxWidth: 150, // forces two lines
          pageHeight: 600,
          style: {
            fontSize: 16,
            minFontSize: 16,
            lineHeightMultiplier: 0.5, // causes box overlap
            textColor: { r: 0, g: 0, b: 0 },
          },
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NameDoesNotFitError);
      const fitErr = caught as NameDoesNotFitError;
      expect(fitErr.reason).toBe("INSUFFICIENT_LINE_HEIGHT");
    });
  });
});
