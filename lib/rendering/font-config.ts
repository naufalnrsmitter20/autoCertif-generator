import { z } from "zod";
import type { RenderCertificateStyle } from "./geometry";
import { InvalidRenderStyleError } from "./errors";

/**
 * Strict Zod schema for CertificateTemplate.fontConfig JSON field.
 * Validates against the RenderCertificateStyle technical contract established in Phase 8.
 */
export const fontConfigSchema = z
  .object({
    fontSize: z
      .number({ message: "fontSize must be a positive number" })
      .positive("fontSize must be a positive number")
      .max(500, "fontSize must not exceed 500 pt"),
    minFontSize: z
      .number({ message: "minFontSize must be a positive number" })
      .positive("minFontSize must be a positive number")
      .max(500, "minFontSize must not exceed 500 pt"),
    lineHeightMultiplier: z
      .number({ message: "lineHeightMultiplier must be a positive number" })
      .positive("lineHeightMultiplier must be a positive number")
      .max(5.0, "lineHeightMultiplier must not exceed 5.0"),
    textColor: z.object(
      {
        r: z
          .number({ message: "r channel must be a number between 0.0 and 1.0" })
          .min(0.0, "r channel must be >= 0.0")
          .max(1.0, "r channel must be <= 1.0"),
        g: z
          .number({ message: "g channel must be a number between 0.0 and 1.0" })
          .min(0.0, "g channel must be >= 0.0")
          .max(1.0, "g channel must be <= 1.0"),
        b: z
          .number({ message: "b channel must be a number between 0.0 and 1.0" })
          .min(0.0, "b channel must be >= 0.0")
          .max(1.0, "b channel must be <= 1.0"),
      },
      { message: "textColor object { r, g, b } is required" }
    ),
    stepSize: z
      .number()
      .positive("stepSize must be a positive number")
      .max(50, "stepSize must not exceed 50 pt")
      .optional(),
  })
  .refine((data) => data.minFontSize <= data.fontSize, {
    message: "minFontSize cannot be greater than fontSize",
    path: ["minFontSize"],
  });

export type FontConfigInput = z.infer<typeof fontConfigSchema>;

/**
 * Parses and validates raw JSON fontConfig from template into a typed RenderCertificateStyle.
 * Throws InvalidRenderStyleError on validation failure.
 */
export function parseFontConfig(raw: unknown): RenderCertificateStyle {
  if (raw === null || raw === undefined) {
    throw new InvalidRenderStyleError("Template fontConfig is required and cannot be empty.");
  }

  const result = fontConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join("; ");
    throw new InvalidRenderStyleError(`Invalid template fontConfig: ${messages}`);
  }

  return {
    fontSize: result.data.fontSize,
    minFontSize: result.data.minFontSize,
    lineHeightMultiplier: result.data.lineHeightMultiplier,
    textColor: result.data.textColor,
    stepSize: result.data.stepSize ?? 1.0,
  };
}
