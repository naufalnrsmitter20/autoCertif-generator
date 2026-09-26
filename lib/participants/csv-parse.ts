"use client";

import Papa from "papaparse";
import { normalizeParticipantName, duplicateKey } from "./normalize";

/**
 * Clean preview model for a single CSV data row.
 *
 * rowNumber: 1-based index relative to the source file (header = row 1,
 *            so first data row = row 2).
 */
export type ParticipantImportRow = {
  rowNumber: number;
  rawName: unknown;
  normalizedName: string | null;
  valid: boolean;
  /** WARNING only — duplicate within the current CSV rows. */
  duplicateInFile: boolean;
  /** WARNING only — duplicate against already-persisted active participants. */
  duplicateExisting: boolean;
  errors: string[];
};

export type CsvParseResult =
  | { ok: true; rows: ParticipantImportRow[] }
  | { ok: false; error: string };

/**
 * Canonical supported header (after trimming + BOM stripping).
 */
const REQUIRED_HEADER = "name";

/**
 * Parse a CSV string and produce a preview result.
 * Environment-agnostic: works in both browser and Node.js (used for testing).
 *
 * @param csvText        Raw CSV string content.
 * @param existingNames  Normalized names already persisted for the batch.
 */
export function parseCsvString(
  csvText: string,
  existingNames: string[]
): CsvParseResult {
  const result = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
    transformHeader: (h: string) => {
      return h.replace(/^\uFEFF/, "").trim();
    },
  });

  // Surface parse-level errors
  if (result.errors.length > 0) {
    const blocking = result.errors.filter(
      (e) =>
        e.type !== "FieldMismatch" ||
        (e.type === "FieldMismatch" && e.code === "TooFewFields")
    );
    if (blocking.length > 0 && result.data.length === 0) {
      const firstError = result.errors[0];
      return {
        ok: false,
        error: `CSV parse error: ${firstError.message || "Malformed file."}`,
      };
    }
  }

  const headers = result.meta.fields ?? [];
  const realHeaders = headers.filter((h) => h.trim().length > 0);

  if (!realHeaders.includes(REQUIRED_HEADER)) {
    return {
      ok: false,
      error: `Required column "name" is missing. Found columns: ${
        realHeaders.length > 0
          ? realHeaders.map((h) => `"${h}"`).join(", ")
          : "(none)"
      }. Please ensure your CSV has a header row with "name".`,
    };
  }

  const unsupported = realHeaders.filter((h) => h !== REQUIRED_HEADER);
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `Unsupported additional column(s): ${unsupported
        .map((h) => `"${h}"`)
        .join(", ")}. The CSV must contain only the "name" column. Please remove unexpected columns and try again.`,
    };
  }

  if (result.data.length === 0) {
    return {
      ok: false,
      error:
        "No participant rows found in the CSV. Please add at least one name.",
    };
  }

  const seenKeys = new Map<string, number>();
  const existingKeys = new Set(existingNames.map((n) => n.toLowerCase()));

  const rows: ParticipantImportRow[] = result.data.map((row, index) => {
    const dataRowNumber = index + 2; // header = row 1
    const rawName = row[REQUIRED_HEADER];
    const normalizedName = normalizeParticipantName(rawName);
    const errors: string[] = [];
    let valid = true;

    if (normalizedName === null) {
      valid = false;
      errors.push("Name is empty or invalid.");
    }

    let duplicateInFile = false;
    let duplicateExisting = false;

    if (normalizedName !== null) {
      const key = duplicateKey(normalizedName);

      if (seenKeys.has(key)) {
        duplicateInFile = true;
      } else {
        seenKeys.set(key, dataRowNumber);
      }

      if (existingKeys.has(key)) {
        duplicateExisting = true;
      }
    }

    return {
      rowNumber: dataRowNumber,
      rawName,
      normalizedName,
      valid,
      duplicateInFile,
      duplicateExisting,
      errors,
    };
  });

  return { ok: true, rows };
}

/**
 * Parse a local File using FileReader in the browser, then delegate to parseCsvString.
 * Browser-only wrapper — not usable in Node.js test environment.
 *
 * @param file            Local CSV File object selected by ADMIN.
 * @param existingNames   Normalized names already persisted for the batch.
 */
export function parseCsvFile(
  file: File,
  existingNames: string[]
): Promise<CsvParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== "string") {
        resolve({ ok: false, error: "Failed to read CSV file as text." });
        return;
      }
      resolve(parseCsvString(text, existingNames));
    };
    reader.onerror = () => {
      resolve({ ok: false, error: "Failed to read CSV file." });
    };
    reader.readAsText(file, "utf-8");
  });
}
