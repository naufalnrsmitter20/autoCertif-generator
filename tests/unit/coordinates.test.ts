import { describe, it, expect } from "vitest";
import {
  NamePlacement,
  DEFAULT_NAME_PLACEMENT,
  recomputeXBounds,
  namePlacementSchema,
  clampPlacement,
  ratioToPixelPlacement,
  pixelToRatioPlacement,
  placementToCSSStyle,
} from "@/lib/coordinates";

describe("lib/coordinates", () => {
  describe("recomputeXBounds", () => {
    it("computes symmetric bounds for default maxWidthRatio (0.7)", () => {
      const bounds = recomputeXBounds(0.7);
      expect(bounds.minXRatio).toBeCloseTo(0.35, 5);
      expect(bounds.maxXRatio).toBeCloseTo(0.65, 5);
    });

    it("computes bounds for full-width (1.0)", () => {
      const bounds = recomputeXBounds(1.0);
      expect(bounds.minXRatio).toBeCloseTo(0.5, 5);
      expect(bounds.maxXRatio).toBeCloseTo(0.5, 5);
    });

    it("computes bounds for narrow width (0.2)", () => {
      const bounds = recomputeXBounds(0.2);
      expect(bounds.minXRatio).toBeCloseTo(0.1, 5);
      expect(bounds.maxXRatio).toBeCloseTo(0.9, 5);
    });
  });

  describe("namePlacementSchema", () => {
    it("accepts valid default placement", () => {
      const result = namePlacementSchema.safeParse(DEFAULT_NAME_PLACEMENT);
      expect(result.success).toBe(true);
    });

    it("accepts valid placement at vertical extremes (yRatio 0 and 1)", () => {
      const topPlacement: NamePlacement = {
        xRatio: 0.5,
        yRatio: 0,
        maxWidthRatio: 0.7,
        alignment: "center",
      };
      const bottomPlacement: NamePlacement = {
        xRatio: 0.5,
        yRatio: 1,
        maxWidthRatio: 0.7,
        alignment: "center",
      };

      expect(namePlacementSchema.safeParse(topPlacement).success).toBe(true);
      expect(namePlacementSchema.safeParse(bottomPlacement).success).toBe(true);
    });

    it("rejects yRatio outside [0, 1]", () => {
      const negativeY = {
        xRatio: 0.5,
        yRatio: -0.01,
        maxWidthRatio: 0.7,
        alignment: "center",
      };
      const oversizedY = {
        xRatio: 0.5,
        yRatio: 1.01,
        maxWidthRatio: 0.7,
        alignment: "center",
      };

      expect(namePlacementSchema.safeParse(negativeY).success).toBe(false);
      expect(namePlacementSchema.safeParse(oversizedY).success).toBe(false);
    });

    it("rejects maxWidthRatio out of bounds (< 0.1 or > 1.0)", () => {
      expect(
        namePlacementSchema.safeParse({
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.05,
          alignment: "center",
        }).success
      ).toBe(false);

      expect(
        namePlacementSchema.safeParse({
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 1.05,
          alignment: "center",
        }).success
      ).toBe(false);
    });

    it("rejects xRatio that would cause name box to exceed page bounds", () => {
      // With width 0.8, half-width is 0.4. Valid xRatio is [0.4, 0.6].
      expect(
        namePlacementSchema.safeParse({
          xRatio: 0.3, // 0.3 - 0.4 = -0.1 (exceeds left boundary)
          yRatio: 0.5,
          maxWidthRatio: 0.8,
          alignment: "center",
        }).success
      ).toBe(false);

      expect(
        namePlacementSchema.safeParse({
          xRatio: 0.7, // 0.7 + 0.4 = 1.1 (exceeds right boundary)
          yRatio: 0.5,
          maxWidthRatio: 0.8,
          alignment: "center",
        }).success
      ).toBe(false);
    });

    it("rejects non-center alignment", () => {
      expect(
        namePlacementSchema.safeParse({
          xRatio: 0.5,
          yRatio: 0.5,
          maxWidthRatio: 0.7,
          alignment: "left",
        }).success
      ).toBe(false);
    });

    it("rejects non-finite numbers", () => {
      expect(
        namePlacementSchema.safeParse({
          xRatio: NaN,
          yRatio: 0.5,
          maxWidthRatio: 0.7,
          alignment: "center",
        }).success
      ).toBe(false);

      expect(
        namePlacementSchema.safeParse({
          xRatio: 0.5,
          yRatio: Infinity,
          maxWidthRatio: 0.7,
          alignment: "center",
        }).success
      ).toBe(false);
    });
  });

  describe("clampPlacement", () => {
    it("returns valid default for empty input", () => {
      const clamped = clampPlacement({});
      expect(clamped).toEqual(DEFAULT_NAME_PLACEMENT);
    });

    it("clamps xRatio when maxWidthRatio forces tighter bounds", () => {
      // width = 0.8 -> minX = 0.4, maxX = 0.6
      const clamped = clampPlacement({
        xRatio: 0.2,
        maxWidthRatio: 0.8,
      });
      expect(clamped.xRatio).toBeCloseTo(0.4, 5);
      expect(clamped.maxWidthRatio).toBeCloseTo(0.8, 5);
    });

    it("clamps yRatio to [0, 1]", () => {
      expect(clampPlacement({ yRatio: -0.5 }).yRatio).toBe(0);
      expect(clampPlacement({ yRatio: 1.5 }).yRatio).toBe(1);
      expect(clampPlacement({ yRatio: 0.42 }).yRatio).toBe(0.42);
    });
  });

  describe("coordinate conversion & round-trip stability", () => {
    it("converts ratio to pixels and back to ratio stably across various surface sizes", () => {
      const surfaceSizes = [
        { width: 1920, height: 1080 },
        { width: 842, height: 595 },
        { width: 390, height: 260 },
      ];

      const testPlacement: NamePlacement = {
        xRatio: 0.55,
        yRatio: 0.62,
        maxWidthRatio: 0.6,
        alignment: "center",
      };

      for (const { width, height } of surfaceSizes) {
        const pixels = ratioToPixelPlacement(testPlacement, width, height);

        // Center X = 0.55 * width, Center Y = 0.62 * height, Box width = 0.6 * width
        expect(pixels.centerX).toBeCloseTo(0.55 * width, 4);
        expect(pixels.centerY).toBeCloseTo(0.62 * height, 4);
        expect(pixels.width).toBeCloseTo(0.6 * width, 4);
        expect(pixels.left).toBeCloseTo(pixels.centerX - pixels.width / 2, 4);

        const restored = pixelToRatioPlacement(
          pixels.centerX,
          pixels.centerY,
          pixels.width,
          width,
          height
        );

        expect(restored.xRatio).toBeCloseTo(testPlacement.xRatio, 4);
        expect(restored.yRatio).toBeCloseTo(testPlacement.yRatio, 4);
        expect(restored.maxWidthRatio).toBeCloseTo(testPlacement.maxWidthRatio, 4);
        expect(restored.alignment).toBe("center");
      }
    });

    it("generates correct percentage-based CSS styles", () => {
      const placement: NamePlacement = {
        xRatio: 0.5,
        yRatio: 0.6,
        maxWidthRatio: 0.7,
        alignment: "center",
      };

      const css = placementToCSSStyle(placement);
      // left = (0.5 - 0.35) * 100% = 15%
      expect(css.left).toBe("15%");
      expect(css.top).toBe("60%");
      expect(css.width).toBe("70%");
      expect(css.transform).toBe("translateY(-50%)");
    });
  });
});
