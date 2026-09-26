import {
  NameDoesNotFitError,
  FontUnsupportedGlyphError,
  InvalidNamePlacementError,
  InvalidRenderStyleError,
  UnsupportedTemplateGeometryError,
  TemplateRenderError,
  FontNotConfiguredError,
} from "@/lib/rendering/errors";

export class GenerationPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationPreflightError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BatchNotEligibleForGenerationError extends Error {
  constructor(message = "Batch is not in eligible state for generation.") {
    super(message);
    this.name = "BatchNotEligibleForGenerationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConcurrentGenerationConflictError extends Error {
  constructor(
    message = "Batch state or template changed concurrently. Generation aborted."
  ) {
    super(message);
    this.name = "ConcurrentGenerationConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Checks whether an error is a participant-specific deterministic domain failure.
 * Only these errors should mark a single Certificate FAILED without failing the batch.
 */
export function isParticipantDomainError(error: unknown): boolean {
  return (
    error instanceof NameDoesNotFitError ||
    error instanceof FontUnsupportedGlyphError
  );
}

/**
 * Checks whether an error is a shared deterministic template/configuration failure.
 * These must be caught during preflight whenever possible.
 */
export function isSharedTemplateError(error: unknown): boolean {
  return (
    error instanceof FontNotConfiguredError ||
    error instanceof InvalidNamePlacementError ||
    error instanceof InvalidRenderStyleError ||
    error instanceof UnsupportedTemplateGeometryError ||
    error instanceof TemplateRenderError
  );
}

/**
 * Converts a caught error to an ADMIN-facing safe structured generation error string.
 * Never exposes stack traces, server internals, or database URLs.
 */
export function toSafeGenerationErrorMessage(error: unknown): string {
  if (error instanceof NameDoesNotFitError) {
    return `NAME_DOES_NOT_FIT: ${error.reason}`;
  }
  if (error instanceof FontUnsupportedGlyphError) {
    const hex = error.codePoint.toString(16).toUpperCase().padStart(4, "0");
    return `UNSUPPORTED_GLYPH: Character "${error.char}" (U+${hex})`;
  }
  if (error instanceof Error && error.message.startsWith("INFRASTRUCTURE_FAILURE:")) {
    return error.message;
  }
  return "RENDER_FAILURE: Rendering failed to complete safely";
}
