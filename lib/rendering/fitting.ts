import { PDFFont } from "pdf-lib";
import { normalizeParticipantName } from "@/lib/participants/normalize";
import { NameDoesNotFitError, NameFitFailureReason } from "./errors";
import {
  RenderCertificateStyle,
  calculateBaselineY,
  calculateStartX,
  calculateTwoLineBaselines,
  checkTwoLineBoxesOverlap,
  checkVerticalPageSafety,
  checkTextFits,
} from "./geometry";
import { measureText } from "./font";

export interface RenderedLine {
  text: string;
  width: number;
  startX: number;
  baselineY: number;
  ascent: number;
  descent: number;
}

export type NameLayoutPlan =
  | {
      mode: "single-line";
      fontSize: number;
      lines: [RenderedLine];
    }
  | {
      mode: "two-line";
      fontSize: number;
      splitIndex: number;
      lines: [RenderedLine, RenderedLine];
    };

export interface CandidateSplit {
  splitIndex: number;
  line1: string;
  line2: string;
}

export interface ValidTwoLineCandidate {
  splitIndex: number;
  line1: string;
  line2: string;
  fontSize: number;
  line1Width: number;
  line2Width: number;
  widthDiff: number;
  maxLineWidth: number;
  ascent: number;
  descent: number;
  baseline1: number;
  baseline2: number;
}

export interface CalculateNameLayoutOptions {
  name: string;
  font: PDFFont;
  centerX: number;
  centerYFromBottom: number;
  maxWidth: number;
  pageHeight: number;
  style: RenderCertificateStyle;
  alignment?: "left" | "center" | "right";
}

/**
 * Generates a strictly descending sequence of candidate font sizes from
 * defaultFontSize down to minFontSize.
 *
 * Avoids floating-point accumulation drift by using index-based stepping
 * and rounds cleanly. Evaluates exact minFontSize once.
 */
export function generateCandidateFontSizes(
  defaultFontSize: number,
  minFontSize: number,
  stepSize = 1.0
): number[] {
  if (defaultFontSize < minFontSize) {
    throw new Error(
      `defaultFontSize (${defaultFontSize}) must be >= minFontSize (${minFontSize})`
    );
  }
  if (stepSize <= 0 || !Number.isFinite(stepSize)) {
    throw new Error(`stepSize must be a positive finite number (received: ${stepSize})`);
  }

  const sizes: number[] = [];
  let k = 0;
  while (true) {
    const size = Math.round((defaultFontSize - k * stepSize) * 10000) / 10000;
    if (size <= minFontSize + 1e-4) {
      break;
    }
    sizes.push(size);
    k++;
  }

  const exactMin = Math.round(minFontSize * 10000) / 10000;
  if (sizes.length === 0 || Math.abs(sizes[sizes.length - 1] - exactMin) > 1e-4) {
    sizes.push(exactMin);
  }

  return sizes;
}

/**
 * Splits a participant name into constituent words by whitespace.
 */
export function splitIntoWords(name: string): string[] {
  const normalized = normalizeParticipantName(name);
  if (!normalized) return [];
  return normalized.split(" ").filter((w) => w.length > 0);
}

/**
 * Generates all valid word-boundary splits for a list of words.
 * For N words (N >= 2), generates exactly N - 1 candidate splits.
 */
export function generateCandidateSplits(words: string[]): CandidateSplit[] {
  if (words.length < 2) return [];

  const splits: CandidateSplit[] = [];
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    splits.push({
      splitIndex: i,
      line1,
      line2,
    });
  }

  return splits;
}

/**
 * Authoritative Name Auto-Fitting and Layout Algorithm (Phase 8).
 *
 * Sequence:
 * 1. Generate candidate font sizes [defaultFontSize, ..., minFontSize].
 * 2. Attempt single-line placement across candidate sizes (largest first).
 *    Validates horizontal fit (width <= maxWidth) and vertical page safety.
 * 3. If single-line fails at all sizes >= minFontSize:
 *    - If words < 2 (single unbroken word): throw NameDoesNotFitError(SINGLE_WORD_OVERFLOW).
 *    - Otherwise, evaluate authoritative two-line policy across all candidate splits.
 * 4. Authoritative Two-Line Policy:
 *    - For each split, find the largest font size in [minFontSize, defaultFontSize] where:
 *        line1Width <= maxWidth
 *        line2Width <= maxWidth
 *        vertical page bounds are safe (top <= pageHeight, bottom >= 0)
 *        typographic line boxes do not overlap
 *    - Discard invalid candidates.
 *    - Deterministically rank remaining candidates by:
 *        1. largest fontSize
 *        2. smallest abs(line1Width - line2Width)
 *        3. smallest max(line1Width, line2Width)
 *        4. earliest splitIndex (tie-break)
 *    - Return the winner.
 * 5. If no candidate fits safely, throws typed NameDoesNotFitError with exact reason.
 */
export function calculateNameLayout(options: CalculateNameLayoutOptions): NameLayoutPlan {
  const {
    name,
    font,
    centerX,
    centerYFromBottom,
    maxWidth,
    pageHeight,
    style,
    alignment = "center",
  } = options;

  const normalizedName = normalizeParticipantName(name);
  if (!normalizedName) {
    throw new NameDoesNotFitError(
      name,
      0,
      maxWidth,
      style.fontSize,
      "SINGLE_LINE_OVERFLOW",
      "Participant name is empty or contains only whitespace."
    );
  }

  const {
    fontSize: defaultFontSize,
    minFontSize,
    lineHeightMultiplier,
    stepSize = 1.0,
  } = style;

  const candidateSizes = generateCandidateFontSizes(
    defaultFontSize,
    minFontSize,
    stepSize
  );

  // ---------------------------------------------------------
  // Step 1: Single-Line Fitting
  // ---------------------------------------------------------
  let singleLineFitFailedDueToVertical = false;

  for (const size of candidateSizes) {
    const { textWidth, ascent, descent } = measureText(font, normalizedName, size);

    if (checkTextFits(textWidth, maxWidth)) {
      const baselineY = calculateBaselineY(centerYFromBottom, ascent, descent);
      const top = baselineY + ascent;
      const bottom = baselineY - descent;

      if (checkVerticalPageSafety(top, bottom, pageHeight)) {
        return {
          mode: "single-line",
          fontSize: size,
          lines: [
            {
              text: normalizedName,
              width: textWidth,
              startX: calculateStartX(centerX, textWidth, maxWidth, alignment),
              baselineY,
              ascent,
              descent,
            },
          ],
        };
      } else {
        singleLineFitFailedDueToVertical = true;
      }
    }
  }

  // ---------------------------------------------------------
  // Step 2: Two-Line Fitting
  // ---------------------------------------------------------
  const words = splitIntoWords(normalizedName);

  if (words.length < 2) {
    // Single unbroken word that cannot be split at whitespace boundaries
    const { textWidth: minSizeWidth } = measureText(font, normalizedName, minFontSize);
    const failureReason: NameFitFailureReason = singleLineFitFailedDueToVertical
      ? "VERTICAL_OVERFLOW"
      : "SINGLE_WORD_OVERFLOW";

    throw new NameDoesNotFitError(
      normalizedName,
      minSizeWidth,
      maxWidth,
      minFontSize,
      failureReason,
      `Single unbroken word "${normalizedName}" cannot fit on one line at minimum font size (${minFontSize} pt) and cannot be split into two lines.`
    );
  }

  const candidateSplits = generateCandidateSplits(words);
  const validCandidates: ValidTwoLineCandidate[] = [];

  let hadHorizontalCandidateAtMin = false;
  let hadVerticalOverflow = false;
  let hadBoxOverlap = false;

  for (const split of candidateSplits) {
    // For each split, find the largest font size in candidateSizes (sorted descending)
    for (const size of candidateSizes) {
      const { textWidth: line1Width } = measureText(font, split.line1, size);
      const { textWidth: line2Width } = measureText(font, split.line2, size);

      const fitsHorizontally =
        checkTextFits(line1Width, maxWidth) && checkTextFits(line2Width, maxWidth);

      if (!fitsHorizontally) {
        continue;
      }

      if (size === minFontSize) {
        hadHorizontalCandidateAtMin = true;
      }

      // Vertical metrics at candidate size
      const totalHeight = font.heightAtSize(size, { descender: true });
      const ascent = font.heightAtSize(size, { descender: false });
      const descent = totalHeight - ascent;
      const lineHeight = size * lineHeightMultiplier;

      const { baseline1, baseline2 } = calculateTwoLineBaselines(
        centerYFromBottom,
        ascent,
        descent,
        lineHeight
      );

      // Verify line boxes do not overlap
      const overlaps = checkTwoLineBoxesOverlap(
        baseline1,
        baseline2,
        ascent,
        descent
      );
      if (overlaps) {
        hadBoxOverlap = true;
        continue;
      }

      // Verify vertical page safety
      const topLineTop = baseline1 + ascent;
      const bottomLineBottom = baseline2 - descent;
      const verticallySafe = checkVerticalPageSafety(
        topLineTop,
        bottomLineBottom,
        pageHeight
      );

      if (!verticallySafe) {
        hadVerticalOverflow = true;
        continue;
      }

      // All 4 conditions met! Since candidateSizes is descending, this is the largest font size for this split.
      const widthDiff = Math.abs(line1Width - line2Width);
      const maxLineWidth = Math.max(line1Width, line2Width);

      validCandidates.push({
        splitIndex: split.splitIndex,
        line1: split.line1,
        line2: split.line2,
        fontSize: size,
        line1Width,
        line2Width,
        widthDiff,
        maxLineWidth,
        ascent,
        descent,
        baseline1,
        baseline2,
      });

      // Break out of font size loop for this split because we found its largest valid size
      break;
    }
  }

  // ---------------------------------------------------------
  // Step 3: Handle Failure
  // ---------------------------------------------------------
  if (validCandidates.length === 0) {
    const { textWidth: fullTextWidthAtMin } = measureText(
      font,
      normalizedName,
      minFontSize
    );

    let failureReason: NameFitFailureReason = "TWO_LINE_OVERFLOW";
    if (hadHorizontalCandidateAtMin) {
      if (hadBoxOverlap && !hadVerticalOverflow) {
        failureReason = "INSUFFICIENT_LINE_HEIGHT";
      } else {
        failureReason = "VERTICAL_OVERFLOW";
      }
    }

    throw new NameDoesNotFitError(
      normalizedName,
      fullTextWidthAtMin,
      maxWidth,
      minFontSize,
      failureReason,
      `Participant name "${normalizedName}" could not fit within layout constraints as two lines at or above minimum font size (${minFontSize} pt). Reason: ${failureReason}.`
    );
  }

  // ---------------------------------------------------------
  // Step 4: Deterministic Ranking
  // ---------------------------------------------------------
  // 1. Largest fontSize
  // 2. Smallest abs(line1Width - line2Width)
  // 3. Smallest max(line1Width, line2Width)
  // 4. Earliest splitIndex (tie-break)
  validCandidates.sort((a, b) => {
    // 1. Largest fontSize
    if (Math.abs(b.fontSize - a.fontSize) > 1e-4) {
      return b.fontSize - a.fontSize;
    }

    // 2. Smallest width difference
    if (Math.abs(a.widthDiff - b.widthDiff) > 1e-4) {
      return a.widthDiff - b.widthDiff;
    }

    // 3. Smallest maximum line width
    if (Math.abs(a.maxLineWidth - b.maxLineWidth) > 1e-4) {
      return a.maxLineWidth - b.maxLineWidth;
    }

    // 4. Earliest split index
    return a.splitIndex - b.splitIndex;
  });

  const winner = validCandidates[0];
  const startX1 = calculateStartX(centerX, winner.line1Width, maxWidth, alignment);
  const startX2 = calculateStartX(centerX, winner.line2Width, maxWidth, alignment);

  return {
    mode: "two-line",
    fontSize: winner.fontSize,
    splitIndex: winner.splitIndex,
    lines: [
      {
        text: winner.line1,
        width: winner.line1Width,
        startX: startX1,
        baselineY: winner.baseline1,
        ascent: winner.ascent,
        descent: winner.descent,
      },
      {
        text: winner.line2,
        width: winner.line2Width,
        startX: startX2,
        baselineY: winner.baseline2,
        ascent: winner.ascent,
        descent: winner.descent,
      },
    ],
  };
}
