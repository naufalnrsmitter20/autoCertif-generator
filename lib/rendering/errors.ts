/**
 * Typed domain errors for certificate rendering.
 */

export class CertificateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertificateRenderError";
  }
}

export class FontNotConfiguredError extends CertificateRenderError {
  constructor(message = "Deterministic font asset is not configured or font bytes are empty.") {
    super(message);
    this.name = "FontNotConfiguredError";
  }
}

export class FontUnsupportedGlyphError extends CertificateRenderError {
  public readonly char: string;
  public readonly codePoint: number;
  public readonly fontName?: string;

  constructor(char: string, codePoint: number, fontName?: string) {
    const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
    super(
      `Font ${fontName ? `"${fontName}" ` : ""}does not support character "${char}" (U+${hex}).`
    );
    this.name = "FontUnsupportedGlyphError";
    this.char = char;
    this.codePoint = codePoint;
    this.fontName = fontName;
  }
}

export class InvalidNamePlacementError extends CertificateRenderError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNamePlacementError";
  }
}

export class InvalidRenderStyleError extends CertificateRenderError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRenderStyleError";
  }
}

export type NameFitFailureReason =
  | "SINGLE_LINE_OVERFLOW"
  | "SINGLE_WORD_OVERFLOW"
  | "TWO_LINE_OVERFLOW"
  | "VERTICAL_OVERFLOW"
  | "INSUFFICIENT_LINE_HEIGHT";

export class NameDoesNotFitError extends CertificateRenderError {
  public readonly textWidth: number;
  public readonly maxWidth: number;
  public readonly fontSize: number;
  public readonly name: string;
  public readonly participantName: string;
  public readonly reason: NameFitFailureReason;

  constructor(
    name: string,
    textWidth: number,
    maxWidth: number,
    fontSize: number,
    reason: NameFitFailureReason = "SINGLE_LINE_OVERFLOW",
    customMessage?: string
  ) {
    const defaultMsg =
      customMessage ??
      `Participant name "${name}" (measured: ${textWidth.toFixed(2)} pt) cannot fit within maximum allowed width (${maxWidth.toFixed(2)} pt) at font size ${fontSize} pt. Reason: ${reason}.`;
    super(defaultMsg);
    this.name = "NameDoesNotFitError";
    this.textWidth = textWidth;
    this.maxWidth = maxWidth;
    this.fontSize = fontSize;
    this.name = name;
    this.participantName = name;
    this.reason = reason;
  }
}

export class UnsupportedTemplateGeometryError extends CertificateRenderError {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTemplateGeometryError";
  }
}

export class TemplateRenderError extends CertificateRenderError {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}
