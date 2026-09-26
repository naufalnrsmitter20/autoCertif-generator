import { describe, it, expect } from "vitest";
import { normalizeParticipantName, duplicateKey } from "@/lib/participants/normalize";

describe("normalizeParticipantName", () => {
  it("trims leading/trailing whitespace", () => {
    expect(normalizeParticipantName("  Naufal  ")).toBe("Naufal");
  });

  it("collapses repeated internal whitespace", () => {
    expect(normalizeParticipantName("  Naufal   Nabil  Ramadhan ")).toBe(
      "Naufal Nabil Ramadhan"
    );
  });

  it("preserves capitalization unchanged", () => {
    expect(normalizeParticipantName("BUDI santoso")).toBe("BUDI santoso");
  });

  it("preserves Unicode accents and punctuation in names", () => {
    expect(normalizeParticipantName("Ángel López-García")).toBe(
      "Ángel López-García"
    );
  });

  it("preserves comma in quoted CSV value", () => {
    expect(normalizeParticipantName("Putri, Ananda")).toBe("Putri, Ananda");
  });

  it("returns null for empty string", () => {
    expect(normalizeParticipantName("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeParticipantName("   ")).toBeNull();
  });

  it("returns null for non-string input (number)", () => {
    expect(normalizeParticipantName(42)).toBeNull();
  });

  it("returns null for non-string input (null)", () => {
    expect(normalizeParticipantName(null)).toBeNull();
  });

  it("returns null for non-string input (undefined)", () => {
    expect(normalizeParticipantName(undefined)).toBeNull();
  });

  it("returns null for non-string input (object)", () => {
    expect(normalizeParticipantName({})).toBeNull();
  });

  it("handles a single name with no extra whitespace", () => {
    expect(normalizeParticipantName("Budi")).toBe("Budi");
  });
});

describe("duplicateKey", () => {
  it("lowercases for case-insensitive comparison", () => {
    expect(duplicateKey("Naufal Nabil")).toBe("naufal nabil");
  });

  it("does not modify the normalized display name", () => {
    const name = "Ángel López";
    const key = duplicateKey(name);
    expect(key).toBe("ángel lópez");
    expect(name).toBe("Ángel López"); // original unchanged
  });

  it("two names that differ only by case produce the same key", () => {
    const a = duplicateKey("Budi Santoso");
    const b = duplicateKey("budi santoso");
    expect(a).toBe(b);
  });
});
