import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { getAvailableProductionFonts } from "@/lib/rendering/public-fonts";
import { PositionEditorClient } from "@/app/admin/batches/[batchId]/position/position-editor-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const fonts = getAvailableProductionFonts();
const template = {
  id: "template-1",
  name: "Certificate",
  fileType: "PNG" as const,
  pageWidth: 800,
  pageHeight: 600,
  namePlacement: null,
  fontFamily: null as string | null,
  fontAssetPath: null as string | null,
  fontConfig: null as unknown,
};

function renderEditor(fontOptions: typeof fonts, overrides: Partial<typeof template> = {}) {
  return renderToStaticMarkup(createElement(PositionEditorClient, {
    batchId: "batch-1",
    batchName: "Batch",
    batchStatus: "DRAFT",
    template: { ...template, ...overrides },
    previewUrl: "/template.png",
    fonts: fontOptions,
  }));
}

describe("position editor production fonts", () => {
  it("passes six serializable DM Sans options with no asset paths or test font", () => {
    expect(fonts).toHaveLength(6);
    expect(fonts.map((font) => [font.label, font.weight])).toEqual([
      ["Light", 300], ["Regular", 400], ["Italic", 400],
      ["Medium", 500], ["SemiBold", 600], ["Bold", 700],
    ]);
    expect(fonts.every((font) => font.family === "DM Sans")).toBe(true);
    expect(JSON.stringify(fonts)).not.toMatch(/assetPath|test-font|tests\/fixtures|public\/fonts/);
    expect(() => JSON.parse(JSON.stringify(fonts))).not.toThrow();
  });

  it("restores an existing variant and preferred size", () => {
    const html = renderEditor(fonts, {
      fontFamily: "DM Sans",
      fontAssetPath: "dm-sans-semibold",
      fontConfig: { fontSize: 32, minFontSize: 16 },
    });
    expect(html).toMatch(/<option value="dm-sans-semibold" selected="">SemiBold<\/option>/);
    expect(html).toContain('aria-label="Font Size"');
    expect(html).toContain('value="32"');
  });

  it("opens null typography without saving it", () => {
    const html = renderEditor(fonts);
    expect(html).toContain('value="DM Sans"');
    expect(html).toMatch(/<option value="dm-sans-regular" selected="">Regular<\/option>/);
    expect(html).toContain("Unsaved changes");
  });

  it("shows a safe state for an empty or missing runtime font list", () => {
    for (const options of [[], undefined as unknown as typeof fonts]) {
      const html = renderEditor(options);
      expect(html).toContain("No production fonts are available");
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="save-position-button"/);
      expect(html).not.toContain("test-font");
    }
  });

  it("warns when a persisted font ID is no longer registered", () => {
    const html = renderEditor(fonts, { fontAssetPath: "removed-font" });
    expect(html).toContain("previously saved font is unavailable");
    expect(html).toMatch(/<option value="dm-sans-regular" selected="">Regular<\/option>/);
  });
});
