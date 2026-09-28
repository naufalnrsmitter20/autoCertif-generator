import { describe, expect, it } from "vitest";
import { namePlacementSchema, pixelToRatioPlacement, ratioToPixelPlacement } from "@/lib/coordinates";
import { calculateStartX } from "@/lib/rendering/geometry";
import { calculateNameLayout } from "@/lib/rendering/fitting";
import { resolveFontBytes } from "@/lib/rendering/font-registry";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

describe("participant name typography placement", () => {
  it("accepts three alignments and defaults legacy placement to center", () => {
    for (const alignment of ["left", "center", "right"]) {
      expect(namePlacementSchema.parse({ xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.7, alignment }).alignment).toBe(alignment);
    }
    expect(namePlacementSchema.parse({ xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.7 }).alignment).toBe("center");
    expect(namePlacementSchema.safeParse({ xRatio: 0.5, yRatio: 0.5, maxWidthRatio: 0.7, alignment: "justify" }).success).toBe(false);
    expect(namePlacementSchema.safeParse({ xRatio: 0.2, yRatio: 0.5, maxWidthRatio: 0.7, alignment: "left" }).success).toBe(false);
  });

  it("keeps ratios stable at different preview scales", () => {
    const placement = { xRatio: 0.6, yRatio: 0.45, maxWidthRatio: 0.5, alignment: "right" as const };
    for (const [width, height] of [[800, 600], [400, 300]]) {
      const pixels = ratioToPixelPlacement(placement, width, height);
      expect(pixelToRatioPlacement(pixels.centerX, pixels.centerY, pixels.width, width, height, placement.alignment)).toEqual(placement);
    }
  });

  it("aligns every measured line within the fixed box", () => {
    const centerX = 400;
    const boxWidth = 300;
    for (const textWidth of [100, 220]) {
      expect(calculateStartX(centerX, textWidth, boxWidth, "left")).toBe(250);
      expect(calculateStartX(centerX, textWidth, boxWidth, "center")).toBe(centerX - textWidth / 2);
      expect(calculateStartX(centerX, textWidth, boxWidth, "right") + textWidth).toBe(550);
    }
  });

  it("applies selected alignment to both wrapped lines using real font metrics", async () => {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const font = await document.embedFont(await resolveFontBytes("dm-sans-regular"));
    const layoutInput = {
      name: "Muhammad Naufal Nabil Ramadhan Santoso",
      font,
      centerX: 400,
      centerYFromBottom: 300,
      maxWidth: 210,
      pageHeight: 600,
      style: { fontSize: 28, minFontSize: 16, lineHeightMultiplier: 1.5, textColor: { r: 0, g: 0, b: 0 } },
    };
    for (const alignment of ["left", "center", "right"] as const) {
      const plan = calculateNameLayout({ ...layoutInput, alignment });
      expect(plan.mode).toBe("two-line");
      for (const line of plan.lines) {
        expect(line.startX).toBeCloseTo(calculateStartX(400, line.width, 210, alignment));
      }
    }
  });
});
