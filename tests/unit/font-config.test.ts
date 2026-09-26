import { describe, it, expect } from "vitest";
import { parseFontConfig } from "@/lib/rendering/font-config";
import { InvalidRenderStyleError } from "@/lib/rendering/errors";

describe("fontConfig Validation & Parsing", () => {
  const validConfig = {
    fontSize: 28,
    minFontSize: 14,
    lineHeightMultiplier: 1.2,
    textColor: { r: 0.1, g: 0.2, b: 0.3 },
    stepSize: 1.0,
  };

  it("successfully parses valid fontConfig", () => {
    const result = parseFontConfig(validConfig);
    expect(result).toEqual({
      fontSize: 28,
      minFontSize: 14,
      lineHeightMultiplier: 1.2,
      textColor: { r: 0.1, g: 0.2, b: 0.3 },
      stepSize: 1.0,
    });
  });

  it("applies default stepSize = 1.0 when omitted", () => {
    const withoutStep = {
      fontSize: validConfig.fontSize,
      minFontSize: validConfig.minFontSize,
      lineHeightMultiplier: validConfig.lineHeightMultiplier,
      textColor: validConfig.textColor,
    };
    const result = parseFontConfig(withoutStep);
    expect(result.stepSize).toBe(1.0);
  });

  it("rejects null or undefined fontConfig with InvalidRenderStyleError", () => {
    expect(() => parseFontConfig(null)).toThrow(InvalidRenderStyleError);
    expect(() => parseFontConfig(undefined)).toThrow(InvalidRenderStyleError);
  });

  it("rejects minFontSize > fontSize", () => {
    expect(() =>
      parseFontConfig({
        ...validConfig,
        fontSize: 16,
        minFontSize: 24,
      })
    ).toThrow(InvalidRenderStyleError);
  });

  it("rejects non-positive fontSize", () => {
    expect(() =>
      parseFontConfig({
        ...validConfig,
        fontSize: 0,
      })
    ).toThrow(InvalidRenderStyleError);

    expect(() =>
      parseFontConfig({
        ...validConfig,
        fontSize: -5,
      })
    ).toThrow(InvalidRenderStyleError);
  });

  it("rejects invalid textColor channels (< 0 or > 1)", () => {
    expect(() =>
      parseFontConfig({
        ...validConfig,
        textColor: { r: 1.5, g: 0.5, b: 0.5 },
      })
    ).toThrow(InvalidRenderStyleError);

    expect(() =>
      parseFontConfig({
        ...validConfig,
        textColor: { r: -0.1, g: 0.5, b: 0.5 },
      })
    ).toThrow(InvalidRenderStyleError);
  });

  it("rejects missing textColor channels", () => {
    expect(() =>
      parseFontConfig({
        ...validConfig,
        textColor: { r: 0.5, g: 0.5 } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      })
    ).toThrow(InvalidRenderStyleError);
  });

  it("validates exact equality minFontSize === fontSize", () => {
    const result = parseFontConfig({
      ...validConfig,
      fontSize: 20,
      minFontSize: 20,
    });
    expect(result.fontSize).toBe(20);
    expect(result.minFontSize).toBe(20);
  });
});
