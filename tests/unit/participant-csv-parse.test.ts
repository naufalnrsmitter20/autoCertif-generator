/**
 * CSV parsing unit tests.
 *
 * Tests exercise actual Papa Parse behavior (not a mock).
 * parseCsvString is environment-agnostic and runs in Node without FileReaderSync.
 */
import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { normalizeParticipantName, duplicateKey } from "@/lib/participants/normalize";
import { parseCsvString } from "@/lib/participants/csv-parse";

// ─── Papa Parse string-parse helpers (sync, node-compatible) ─────────────────

function parseRows(csv: string): Record<string, unknown>[] {
  const result = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.replace(/^\uFEFF/, "").trim(),
  });
  return result.data;
}

// ─── Papa Parse string parsing ────────────────────────────────────────────────

describe("CSV header contract and parsing (Papa Parse string mode)", () => {
  it("parses a valid CSV with name header", () => {
    const csv = `name\nNaufal Nabil Ramadhan\nBudi Santoso`;
    const rows = parseRows(csv);
    expect(rows).toHaveLength(2);
    expect(normalizeParticipantName(rows[0].name)).toBe("Naufal Nabil Ramadhan");
    expect(normalizeParticipantName(rows[1].name)).toBe("Budi Santoso");
  });

  it("strips UTF-8 BOM before the name header", () => {
    const csv = `\uFEFFname\nNaufal`;
    const result = Papa.parse<Record<string, unknown>>(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.replace(/^\uFEFF/, "").trim(),
    });
    expect(result.meta.fields).toContain("name");
    const rows = result.data;
    expect(rows).toHaveLength(1);
    expect(normalizeParticipantName(rows[0].name)).toBe("Naufal");
  });

  it("trims surrounding whitespace from header", () => {
    const csv = `  name  \nNaufal`;
    const result = Papa.parse<Record<string, unknown>>(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.replace(/^\uFEFF/, "").trim(),
    });
    expect(result.meta.fields).toContain("name");
  });

  it("detects missing name header (fields do not include name)", () => {
    const csv = `email\ntest@example.com`;
    const result = Papa.parse<Record<string, unknown>>(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.replace(/^\uFEFF/, "").trim(),
    });
    expect(result.meta.fields).not.toContain("name");
  });

  it("skips blank lines with skipEmptyLines: true", () => {
    const csv = `name\nNaufal\n\n\nBudi`;
    const rows = parseRows(csv);
    expect(rows).toHaveLength(2);
  });

  it("parses quoted CSV field containing comma correctly", () => {
    const csv = `name\n"Putri, Ananda"\nBudi`;
    const rows = parseRows(csv);
    expect(rows).toHaveLength(2);
    expect(normalizeParticipantName(rows[0].name)).toBe("Putri, Ananda");
  });
});

// ─── Name normalization in context of parsed rows ────────────────────────────

describe("Name normalization from parsed CSV rows", () => {
  it("normalizes leading/trailing whitespace from CSV value", () => {
    const csv = `name\n  Budi    Santoso  `;
    const rows = parseRows(csv);
    expect(normalizeParticipantName(rows[0].name)).toBe("Budi Santoso");
  });

  it("whitespace-only name is invalid after normalization", () => {
    const csv = `name\n   `;
    const rows = parseRows(csv);
    const valid = rows.filter((r) => normalizeParticipantName(r.name) !== null);
    expect(valid).toHaveLength(0);
  });

  it("preserves capitalization", () => {
    const csv = `name\nÁNGEL`;
    const rows = parseRows(csv);
    expect(normalizeParticipantName(rows[0].name)).toBe("ÁNGEL");
  });

  it("preserves Unicode accents and punctuation", () => {
    const csv = `name\nÁngel López-García`;
    const rows = parseRows(csv);
    expect(normalizeParticipantName(rows[0].name)).toBe("Ángel López-García");
  });
});

// ─── Duplicate detection ──────────────────────────────────────────────────────

describe("Duplicate detection logic", () => {
  it("detects duplicate within file (case-insensitive)", () => {
    const names = ["Naufal Nabil", "naufal nabil"];
    const keys = names
      .map((n) => normalizeParticipantName(n))
      .filter(Boolean)
      .map((n) => duplicateKey(n!));
    expect(keys[0]).toBe(keys[1]);
  });

  it("detects duplicate after whitespace normalization", () => {
    const a = normalizeParticipantName("  Naufal   Nabil ");
    const b = normalizeParticipantName("Naufal Nabil");
    expect(a).toBe(b);
    expect(duplicateKey(a!)).toBe(duplicateKey(b!));
  });

  it("duplicate rows remain valid (warning, not error)", () => {
    const n1 = normalizeParticipantName("Budi Santoso");
    const n2 = normalizeParticipantName("Budi Santoso");
    expect(n1).not.toBeNull();
    expect(n2).not.toBeNull();
  });
});

// ─── parseCsvString (environment-agnostic) ────────────────────────────────────

describe("parseCsvString (environment-agnostic, actual Papa Parse)", () => {
  it("returns ok with valid rows for standard CSV", () => {
    const csv = `name\nNaufal Nabil Ramadhan\nBudi Santoso`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].normalizedName).toBe("Naufal Nabil Ramadhan");
    expect(result.rows[0].valid).toBe(true);
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].normalizedName).toBe("Budi Santoso");
    expect(result.rows[1].rowNumber).toBe(3);
  });

  it("returns ok:false for missing name header", () => {
    const csv = `email\ntest@example.com`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("returns ok:false for unsupported additional non-empty header", () => {
    const csv = `name,email\nNaufal,n@example.com`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/email/i);
  });

  it("returns ok:false when no data rows exist", () => {
    const csv = `name`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(false);
  });

  it("strips UTF-8 BOM from header", () => {
    const csv = `\uFEFFname\nNaufal`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].normalizedName).toBe("Naufal");
  });

  it("marks duplicateInFile for repeated normalized names", () => {
    const csv = `name\nNaufal Nabil\nnaufal nabil`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const duplicates = result.rows.filter((r) => r.duplicateInFile);
    expect(duplicates.length).toBeGreaterThanOrEqual(1);
  });

  it("marks duplicateExisting when name matches already-persisted participant", () => {
    const csv = `name\nNaufal Nabil`;
    const result = parseCsvString(csv, ["Naufal Nabil"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].duplicateExisting).toBe(true);
  });

  it("duplicate rows remain valid (importable)", () => {
    const csv = `name\nBudi Santoso\nBudi Santoso`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.every((r) => r.valid)).toBe(true);
  });

  it("row numbers start at 2 for first data row (header = row 1)", () => {
    const csv = `name\nFirst\nSecond\nThird`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].rowNumber).toBe(3);
    expect(result.rows[2].rowNumber).toBe(4);
  });

  it("marks whitespace-only name row as invalid", () => {
    // A value that is whitespace-only in CSV quotes — Papa Parse keeps it as a data row
    // but normalization returns null, marking it invalid.
    const csv = `name\nNaufal\n"   "\nBudi`;
    const result = parseCsvString(csv, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3 rows total: "Naufal", "   " (whitespace-only → invalid), "Budi"
    const invalid = result.rows.filter((r) => !r.valid);
    expect(invalid.length).toBeGreaterThanOrEqual(1);
  });
});
