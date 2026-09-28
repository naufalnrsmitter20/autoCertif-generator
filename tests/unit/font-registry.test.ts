import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveFontBytes,
  registerTestFont,
  clearTestFontRegistry,
  PRODUCTION_FONT_REGISTRY,
  PRODUCTION_FONTS,
} from "@/lib/rendering/font-registry";
import { FontNotConfiguredError } from "@/lib/rendering/errors";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

describe("Font Registry & Asset Resolution", () => {
  beforeEach(() => {
    clearTestFontRegistry();
  });

  afterEach(() => {
    clearTestFontRegistry();
  });

  it("resolves every bundled DM Sans variant without exposing the test fixture", async () => {
    expect(PRODUCTION_FONTS.map((font) => font.id)).toEqual([
      "dm-sans-light", "dm-sans-regular", "dm-sans-italic", "dm-sans-medium", "dm-sans-semibold", "dm-sans-bold",
    ]);
    expect(Object.values(PRODUCTION_FONT_REGISTRY)).not.toContain("tests/fixtures/fonts/test-font.ttf");
    for (const font of PRODUCTION_FONTS) {
      expect((await resolveFontBytes(font.id)).length).toBeGreaterThan(1000);
    }
  });

  it("embeds a selected production weight in a PDF", async () => {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const font = await document.embedFont(await resolveFontBytes("dm-sans-semibold"));
    expect(font.widthOfTextAtSize("Participant Name", 28)).toBeGreaterThan(0);
    expect((await document.save()).length).toBeGreaterThan(1000);
  });

  it("throws FontNotConfiguredError when fontAssetPath is null, undefined, or blank", async () => {
    await expect(resolveFontBytes(null)).rejects.toThrow(FontNotConfiguredError);
    await expect(resolveFontBytes(undefined)).rejects.toThrow(FontNotConfiguredError);
    await expect(resolveFontBytes("")).rejects.toThrow(FontNotConfiguredError);
    await expect(resolveFontBytes("   ")).rejects.toThrow(FontNotConfiguredError);
  });

  it("throws FontNotConfiguredError when font identifier is not registered", async () => {
    await expect(resolveFontBytes("unregistered-font")).rejects.toThrow(
      FontNotConfiguredError
    );
    await expect(resolveFontBytes("unregistered-font")).rejects.toThrow(/not configured in the font registry/);
  });

  it("resolves registered test font bytes in test environment", async () => {
    registerTestFont("test-font", "tests/fixtures/fonts/test-font.ttf");

    const bytes = await resolveFontBytes("test-font");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("throws FontNotConfiguredError if registered file path does not exist", async () => {
    registerTestFont("missing-file-font", "tests/fixtures/fonts/non-existent.ttf");

    await expect(resolveFontBytes("missing-file-font")).rejects.toThrow(
      FontNotConfiguredError
    );
  });

  it("prevents path traversal outside project root", async () => {
    registerTestFont(
      "traversal-font",
      "../../../../../../../../../../../../windows/system32/cmd.exe"
    );

    await expect(resolveFontBytes("traversal-font")).rejects.toThrow(
      FontNotConfiguredError
    );
  });
});
