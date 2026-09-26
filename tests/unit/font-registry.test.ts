import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveFontBytes,
  registerTestFont,
  clearTestFontRegistry,
  PRODUCTION_FONT_REGISTRY,
} from "@/lib/rendering/font-registry";
import { FontNotConfiguredError } from "@/lib/rendering/errors";

describe("Font Registry & Asset Resolution", () => {
  beforeEach(() => {
    clearTestFontRegistry();
  });

  afterEach(() => {
    clearTestFontRegistry();
  });

  it("verifies production font registry is empty (production font NOT CONFIGURED)", () => {
    expect(Object.keys(PRODUCTION_FONT_REGISTRY)).toHaveLength(0);
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
    await expect(resolveFontBytes("unregistered-font")).rejects.toThrow(
      /Real production font remains NOT CONFIGURED/
    );
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
