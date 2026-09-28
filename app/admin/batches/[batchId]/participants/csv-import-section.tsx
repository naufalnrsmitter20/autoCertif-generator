"use client";

import { useState, useRef, useTransition } from "react";
import { parseCsvFile, type ParticipantImportRow } from "@/lib/participants/csv-parse";
import { importParticipantsAction } from "./actions";

interface CsvImportSectionProps {
  batchId: string;
  existingNames: string[];
  onImportSuccess: () => void;
}

type ParseState =
  | { status: "idle" }
  | { status: "parsing" }
  | { status: "preview"; fileName: string; rows: ParticipantImportRow[] }
  | { status: "error"; error: string };

export function CsvImportSection({
  batchId,
  existingNames,
  onImportSuccess,
}: CsvImportSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parseState, setParseState] = useState<ParseState>({ status: "idle" });
  const [isImporting, startImportTransition] = useTransition();
  const [importResult, setImportResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setParseState({ status: "idle" });
      return;
    }

    setParseState({ status: "parsing" });
    setImportResult(null);

    const result = await parseCsvFile(file, existingNames);

    if (!result.ok) {
      setParseState({ status: "error", error: result.error });
      return;
    }

    setParseState({ status: "preview", fileName: file.name, rows: result.rows });
  };

  const handleClearPreview = () => {
    setParseState({ status: "idle" });
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const validRows =
    parseState.status === "preview"
      ? parseState.rows.filter((r) => r.valid)
      : [];

  const handleConfirmImport = () => {
    if (validRows.length === 0) return;

    const names = validRows.map((r) => r.normalizedName as string);

    startImportTransition(async () => {
      const result = await importParticipantsAction(batchId, names);
      if (result.success) {
        setImportResult({
          success: true,
          message: result.error ?? `${names.length} participant(s) imported successfully.`,
        });
        setParseState({ status: "idle" });
        if (fileInputRef.current) fileInputRef.current.value = "";
        onImportSuccess();
      } else {
        setImportResult({
          success: false,
          message: result.error ?? "Import failed.",
        });
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* File picker */}
      {parseState.status === "idle" || parseState.status === "error" ? (
        <div>
          <label
            htmlFor="csv-file-input"
            className="block text-sm font-medium text-charcoal mb-1"
          >
            Select CSV file
          </label>
          <input
            id="csv-file-input"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            data-testid="csv-file-input"
            className="block w-full text-sm text-zinc-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-telkom-red file:text-white hover:file:bg-telkom-red-dark focus:outline-none"
          />
          <p className="mt-1 text-xs text-neutral-gray">
            Required column: name. Duplicate names are allowed and will be shown as warnings.
          </p>
          <a
            href="/autocertif-participant-template.csv"
            download="autocertif-participant-template.csv"
            className="mt-3 inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
          >
            Download CSV Template
          </a>
        </div>
      ) : null}

      {/* Parsing indicator */}
      {parseState.status === "parsing" && (
        <p className="text-sm text-neutral-gray animate-pulse">Parsing CSV...</p>
      )}

      {/* File-level error */}
      {parseState.status === "error" && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="csv-parse-error"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <span className="font-semibold">Error: </span>
          {parseState.error}
          <div className="mt-2">
            <button
              type="button"
              onClick={handleClearPreview}
              className="text-xs text-red-700 underline hover:text-red-900 focus:outline-none focus:ring-2 focus:ring-red-600 rounded"
            >
              Try another file
            </button>
          </div>
        </div>
      )}

      {/* Preview table */}
      {parseState.status === "preview" && (
        <div data-testid="csv-preview-container" className="space-y-4">
          {/* Summary bar */}
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
            <p className="font-medium text-charcoal">
              Preview:{" "}
              <span className="font-normal text-neutral-gray">
                {parseState.fileName}
              </span>
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-gray">
              <span>
                Total rows:{" "}
                <strong className="text-charcoal">{parseState.rows.length}</strong>
              </span>
              <span>
                Valid:{" "}
                <strong className="text-emerald-700">{validRows.length}</strong>
              </span>
              <span>
                Invalid:{" "}
                <strong className="text-red-700">
                  {parseState.rows.filter((r) => !r.valid).length}
                </strong>
              </span>
              <span>
                Duplicate warnings:{" "}
                <strong className="text-amber-700">
                  {
                    parseState.rows.filter(
                      (r) => r.duplicateInFile || r.duplicateExisting
                    ).length
                  }
                </strong>
              </span>
            </div>
          </div>

          {/* Row table — horizontally scrollable on mobile */}
          <div className="overflow-x-auto rounded-md border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50">
                <tr>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-gray"
                  >
                    Row
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-gray"
                  >
                    Participant Name
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-gray"
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {parseState.rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    data-testid={`csv-row-${row.rowNumber}`}
                    className={
                      !row.valid
                        ? "bg-red-50"
                        : row.duplicateInFile || row.duplicateExisting
                        ? "bg-amber-50"
                        : undefined
                    }
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-gray font-mono">
                      {row.rowNumber}
                    </td>
                    <td className="px-3 py-2 text-sm text-charcoal font-medium break-words max-w-[320px]">
                      {row.normalizedName ?? (
                        <em className="text-red-600 not-italic">
                          {String(row.rawName ?? "").trim() === ""
                            ? "(empty)"
                            : String(row.rawName)}
                        </em>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!row.valid ? (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-red-800 font-semibold"
                          aria-label="Invalid row"
                        >
                          ✗ Invalid: {row.errors.join("; ")}
                        </span>
                      ) : row.duplicateInFile || row.duplicateExisting ? (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-amber-800 font-semibold"
                          aria-label="Duplicate warning"
                          data-testid="duplicate-warning"
                        >
                          ⚠ Duplicate
                          {row.duplicateInFile && " (in file)"}
                          {row.duplicateExisting && " (existing)"}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 font-semibold"
                          aria-label="Valid row"
                        >
                          ✓ Valid
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Import controls */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={isImporting || validRows.length === 0}
              data-testid="confirm-import-button"
              className="inline-flex items-center justify-center rounded-md bg-telkom-red px-4 py-2 text-sm font-semibold text-white hover:bg-telkom-red-dark focus:outline-none focus:ring-2 focus:ring-telkom-red disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isImporting
                ? "Importing..."
                : `Import ${validRows.length} Valid Row${validRows.length !== 1 ? "s" : ""}`}
            </button>
            <button
              type="button"
              onClick={handleClearPreview}
              disabled={isImporting}
              data-testid="clear-preview-button"
              className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
            >
              Choose Another File
            </button>
          </div>

          {validRows.length === 0 && (
            <p className="text-xs text-red-700">
              No valid rows to import. Fix the errors above or choose another
              file.
            </p>
          )}
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <div
          role="alert"
          aria-live="polite"
          data-testid={importResult.success ? "import-success" : "import-error"}
          className={`rounded-md border p-3 text-sm ${
            importResult.success
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {importResult.message}
        </div>
      )}
    </div>
  );
}
