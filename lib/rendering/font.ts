import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont } from "pdf-lib";
import {
  FontNotConfiguredError,
  FontUnsupportedGlyphError,
  CertificateRenderError,
} from "./errors";

/**
 * Registers fontkit with a PDFDocument instance if not already registered.
 */
export function registerFontkit(doc: PDFDocument): void {
  try {
    doc.registerFontkit(fontkit);
  } catch (error) {
    // pdf-lib throws if already registered on the same instance; safe to ignore
    if (
      !(error instanceof Error) ||
      !error.message.toLowerCase().includes("already registered")
    ) {
      throw new CertificateRenderError(
        `Failed to register fontkit: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Embeds a custom deterministic font asset into a PDF document using fontkit.
 */
export async function embedCustomFont(
  doc: PDFDocument,
  fontBytes: Uint8Array | Buffer,
  fontFamily?: string
): Promise<PDFFont> {
  if (!fontBytes || fontBytes.byteLength === 0) {
    throw new FontNotConfiguredError(
      `Font asset bytes are empty or undefined${fontFamily ? ` for font "${fontFamily}"` : ""}.`
    );
  }

  registerFontkit(doc);

  try {
    const font = await doc.embedFont(fontBytes);
    return font;
  } catch (error) {
    if (error instanceof CertificateRenderError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CertificateRenderError(
      `Failed to embed font${fontFamily ? ` "${fontFamily}"` : ""}: ${message}`
    );
  }
}

/**
 * Validates that every character in the participant name is supported
 * by the embedded font's character set.
 *
 * Iterates strictly over 32-bit Unicode code points to handle surrogate pairs.
 * Throws FontUnsupportedGlyphError on the first unsupported character.
 */
export function validateFontGlyphSupport(
  font: PDFFont,
  text: string,
  fontName?: string
): void {
  const supportedCodePoints = new Set(font.getCharacterSet());

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || !supportedCodePoints.has(codePoint)) {
      throw new FontUnsupportedGlyphError(
        char,
        codePoint ?? 0,
        fontName || font.name
      );
    }
  }
}

export interface FontMetrics {
  textWidth: number;
  totalHeight: number;
  ascent: number;
  descent: number;
}

/**
 * Measures text width and font typographic box metrics using actual PDFFont methods.
 */
export function measureText(
  font: PDFFont,
  text: string,
  fontSize: number
): FontMetrics {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const totalHeight = font.heightAtSize(fontSize, { descender: true });
  const ascent = font.heightAtSize(fontSize, { descender: false });
  const descent = totalHeight - ascent;

  return {
    textWidth,
    totalHeight,
    ascent,
    descent,
  };
}
