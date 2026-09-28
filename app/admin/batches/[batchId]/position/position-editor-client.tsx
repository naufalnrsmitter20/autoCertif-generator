"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Rnd } from "react-rnd";
import type { PublicFontOption } from "@/lib/rendering/public-fonts";
import {
  NamePlacement,
  DEFAULT_NAME_PLACEMENT,
  clampPlacement,
  ratioToPixelPlacement,
  pixelToRatioPlacement,
} from "@/lib/coordinates";

export type TemplateFileType = "PDF" | "PNG" | "JPG";
export type BatchStatus =
  | "DRAFT"
  | "READY"
  | "GENERATING"
  | "GENERATED"
  | "PUBLISHED"
  | "FAILED";

interface TemplateInfo {
  id: string;
  name: string;
  fileType: TemplateFileType;
  pageWidth: number | null;
  pageHeight: number | null;
  namePlacement: unknown;
  fontFamily: string | null;
  fontAssetPath: string | null;
  fontConfig: unknown;
}
interface PositionEditorClientProps {
  batchId: string;
  batchName: string;
  batchStatus: BatchStatus;
  template: TemplateInfo;
  previewUrl: string;
  fonts: PublicFontOption[];
}

export function PositionEditorClient({
  batchId,
  batchName,
  batchStatus,
  template,
  previewUrl,
  fonts,
}: PositionEditorClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const availableFonts = Array.isArray(fonts) ? fonts : [];
  const defaultFont = availableFonts.find((font) => font.weight === 400 && font.style === "normal") ?? availableFonts[0] ?? null;
  const initialFont = availableFonts.find((font) => font.id === template.fontAssetPath) ?? defaultFont;
  const persistedFontUnavailable = Boolean(template.fontAssetPath) && !availableFonts.some((font) => font.id === template.fontAssetPath);

  // Initialize placement from persisted template.namePlacement or default
  const initialPlacement: NamePlacement = clampPlacement(
    template.namePlacement || DEFAULT_NAME_PLACEMENT
  );

  const [placement, setPlacement] = useState<NamePlacement>(initialPlacement);
  const [savedPlacement, setSavedPlacement] = useState<NamePlacement>(initialPlacement);
  const initialSize = typeof template.fontConfig === "object" && template.fontConfig !== null && "fontSize" in template.fontConfig && typeof template.fontConfig.fontSize === "number" ? template.fontConfig.fontSize : 28;
  const minimumSize = typeof template.fontConfig === "object" && template.fontConfig !== null && "minFontSize" in template.fontConfig && typeof template.fontConfig.minFontSize === "number" ? template.fontConfig.minFontSize : 16;
  const [fontId, setFontId] = useState(initialFont?.id ?? "");
  const [savedFontId, setSavedFontId] = useState(template.fontAssetPath);
  const [fontSize, setFontSize] = useState(initialSize);
  const [savedFontSize, setSavedFontSize] = useState(initialSize);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStaleConflict, setIsStaleConflict] = useState(false);

  // Surface and canvas refs
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfRendered, setPdfRendered] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const isDraft = batchStatus === "DRAFT";
  const isDirty =
    Math.abs(placement.xRatio - savedPlacement.xRatio) > 0.0001 ||
    Math.abs(placement.yRatio - savedPlacement.yRatio) > 0.0001 ||
    Math.abs(placement.maxWidthRatio - savedPlacement.maxWidthRatio) > 0.0001 ||
    placement.alignment !== savedPlacement.alignment || fontId !== savedFontId || fontSize !== savedFontSize;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => setSurfaceSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  // Aspect ratio calculation
  const pageWidth = template.pageWidth && template.pageWidth > 0 ? template.pageWidth : 842;
  const pageHeight = template.pageHeight && template.pageHeight > 0 ? template.pageHeight : 595;
  const aspectRatio = `${pageWidth} / ${pageHeight}`;

  // Client-side PDF rendering to canvas using pdfjs-dist
  useEffect(() => {
    let active = true;

    if (template.fileType !== "PDF" || !previewUrl) {
      return;
    }

    async function renderPdf() {
      try {
        setPdfError(null);
        setPdfRendered(false);

        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const loadingTask = pdfjsLib.getDocument({ url: previewUrl });
        const pdf = await loadingTask.promise;

        if (!active) return;

        const page = await pdf.getPage(1);
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Render at 2x or devicePixelRatio for sharp HiDPI display
        const dpr = window.devicePixelRatio || 1;
        const scale = 2.0;
        const viewport = page.getViewport({ scale });

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        await page.render({
          canvasContext: ctx,
          viewport: viewport,
          canvas,
        }).promise;

        if (active) {
          setPdfRendered(true);
        }
      } catch (err: unknown) {
        if (active) {
          console.error("PDF preview rendering error:", err);
          setPdfError(
            err instanceof Error ? err.message : "Failed to render PDF preview."
          );
        }
      }
    }

    renderPdf();

    return () => {
      active = false;
    };
  }, [template.fileType, previewUrl]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isDraft) return;

    const step = e.shiftKey ? 0.05 : 0.01;
    let nextX = placement.xRatio;
    let nextY = placement.yRatio;
    let nextWidth = placement.maxWidthRatio;
    let handled = false;

    switch (e.key) {
      case "ArrowLeft":
        nextX -= step;
        handled = true;
        break;
      case "ArrowRight":
        nextX += step;
        handled = true;
        break;
      case "ArrowUp":
        nextY -= step;
        handled = true;
        break;
      case "ArrowDown":
        nextY += step;
        handled = true;
        break;
      case "[":
      case "-":
        nextWidth = Math.max(0.1, nextWidth - 0.02);
        handled = true;
        break;
      case "]":
      case "+":
      case "=":
        nextWidth = Math.min(1.0, nextWidth + 0.02);
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      const updated = clampPlacement({
        xRatio: nextX,
        yRatio: nextY,
        maxWidthRatio: nextWidth,
        alignment: placement.alignment,
      });
      setPlacement(updated);
      setSaveSuccess(false);
    }
  };

  // Width slider change
  const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = Number(e.target.value) / 100;
    // Guardrail 5: immediately recompute xRatio bounds and clamp
    const updated = clampPlacement({
      xRatio: placement.xRatio,
      yRatio: placement.yRatio,
      maxWidthRatio: rawVal,
      alignment: placement.alignment,
    });
    setPlacement(updated);
    setSaveSuccess(false);
  };

  // Reset to last saved
  const handleReset = () => {
    setPlacement(savedPlacement);
    setFontId(availableFonts.find((font) => font.id === savedFontId)?.id ?? defaultFont?.id ?? "");
    setFontSize(savedFontSize);
    setSaveSuccess(false);
    setErrorMessage(null);
  };

  // Save placement to server
  const handleSave = async () => {
    if (!isDraft || !selectedFont) return;

    setIsSaving(true);
    setErrorMessage(null);
    setIsStaleConflict(false);
    setSaveSuccess(false);

    try {
      const response = await fetch(
        `/api/admin/batches/${batchId}/template/position`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: template.id,
            placement,
            typography: { fontFamily: selectedFont.family, fontAssetPath: selectedFont.id, fontSize },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409 || data.code === "STALE_TEMPLATE") {
          setIsStaleConflict(true);
          throw new Error(
            data.error ||
              "The certificate template changed. Reload the editor before saving placement."
          );
        }
        throw new Error(data.error || "Failed to save placement.");
      }

      setSavedPlacement(placement);
      setSavedFontId(fontId);
      setSavedFontSize(fontSize);
      setSaveSuccess(true);
      startTransition(() => {
        router.refresh();
      });
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const selectedFont = availableFonts.find((font) => font.id === fontId) ?? null;
  const fontFamilies = [...new Set(availableFonts.map((font) => font.family))];
  const familyFonts = availableFonts.filter((font) => font.family === selectedFont?.family);
  const pixelPlacement = ratioToPixelPlacement(placement, surfaceSize.width, surfaceSize.height);
  const boxHeight = Math.max(24, Math.min(surfaceSize.height, fontSize * surfaceSize.width / pageWidth * 1.7));

  return (
    <div
      data-testid="name-position-editor"
      className="space-y-4"
    >
      {/* Editor Controls Bar */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {batchName} &bull; Template
            </span>
            <p className="text-sm font-bold text-charcoal truncate max-w-xs">
              {template.name} ({template.fileType})
            </p>
          </div>

          <div className="h-8 w-px bg-zinc-200 hidden sm:block" />

          {/* Width Control */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="width-slider"
              className="text-xs font-medium text-zinc-700 whitespace-nowrap"
            >
              Max Width:
            </label>
            <input
              id="width-slider"
              type="range"
              min="10"
              max="100"
              step="1"
              value={Math.round(placement.maxWidthRatio * 100)}
              onChange={handleWidthChange}
              disabled={!isDraft || isSaving}
              data-testid="name-width-slider"
              className="w-28 sm:w-36 accent-telkom-red cursor-pointer disabled:opacity-50"
              aria-label="Participant name max width"
            />
            <span
              data-testid="width-percentage-display"
              className="text-xs font-mono font-semibold text-zinc-800 w-10 text-right"
            >
              {Math.round(placement.maxWidthRatio * 100)}%
            </span>
          </div>

          {/* Placement Coordinates Display */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-zinc-500 font-mono">
            <span>X: {(placement.xRatio * 100).toFixed(1)}%</span>
            <span>&bull;</span>
            <span>Y: {(placement.yRatio * 100).toFixed(1)}%</span>
          </div>
        </div>

        {/* Action Buttons & Status */}
        <div className="flex items-center gap-3 self-end md:self-auto">
          {saveSuccess && !isDirty && (
            <span
              data-testid="save-success-indicator"
              className="inline-flex items-center text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1"
            >
              Saved
            </span>
          )}

          {isDirty && (
            <span
              data-testid="unsaved-changes-indicator"
              className="inline-flex items-center text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1"
            >
              Unsaved changes
            </span>
          )}

          {isDirty && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving}
              data-testid="reset-position-button"
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
            >
              Reset
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!isDraft || isSaving || !isDirty || !selectedFont}
            data-testid="save-position-button"
            className="inline-flex items-center justify-center rounded-md bg-telkom-red hover:bg-telkom-red-dark px-4 py-1.5 text-xs font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-telkom-red focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>

      {availableFonts.length === 0 && <p role="alert" className="rounded-md border border-telkom-red-border bg-telkom-red-light p-3 text-sm text-telkom-red-dark">No production fonts are available. Configure a production font before saving this template.</p>}
      {persistedFontUnavailable && availableFonts.length > 0 && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The previously saved font is unavailable. Select a registered font and save to update this template.</p>}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 bg-white p-4">
        <label className="grid gap-1 text-xs font-medium text-zinc-700">Font
          <select aria-label="Font" value={selectedFont?.family ?? ""} disabled={!isDraft || isSaving || availableFonts.length === 0} onChange={(event) => { setFontId(availableFonts.find((font) => font.family === event.target.value)?.id ?? ""); setSaveSuccess(false); }} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
            {fontFamilies.length === 0 && <option value="">No fonts available</option>}
            {fontFamilies.map((family) => <option key={family} value={family}>{family}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-700">Weight
          <select aria-label="Weight" value={fontId} disabled={!isDraft || isSaving || !selectedFont} onChange={(event) => { setFontId(event.target.value); setSaveSuccess(false); }} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
            {familyFonts.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-700">Font Size (pt)
          <input aria-label="Font Size" type="number" min={minimumSize} max="500" step="1" value={fontSize} disabled={!isDraft || isSaving || !selectedFont} onChange={(event) => { setFontSize(Number(event.target.value)); setSaveSuccess(false); }} className="w-28 rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        </label>
        <fieldset className="grid gap-1 text-xs font-medium text-zinc-700"><legend>Alignment</legend>
          <div className="flex rounded-md border border-zinc-300 p-0.5">
            {(["left", "center", "right"] as const).map((alignment) => <button key={alignment} type="button" aria-label={`Align ${alignment}`} aria-pressed={placement.alignment === alignment} disabled={!isDraft || isSaving} onClick={() => { setPlacement({ ...placement, alignment }); setSaveSuccess(false); }} className={`rounded px-3 py-1.5 uppercase ${placement.alignment === alignment ? "bg-telkom-red text-white" : "text-zinc-700 hover:bg-zinc-100"}`}>{alignment}</button>)}
          </div>
        </fieldset>
      </div>

      {/* Error / Conflict Banner */}
      {errorMessage && (
        <div
          data-testid="position-editor-error-banner"
          role="alert"
          className="rounded-md border border-telkom-red-border bg-telkom-red-light p-4 text-sm text-telkom-red-dark flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div>
            <p className="font-semibold">
              {isStaleConflict ? "Template Conflict" : "Failed to Save Position"}
            </p>
            <p className="mt-0.5 text-xs text-telkom-red-dark">{errorMessage}</p>
          </div>
          {isStaleConflict && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              data-testid="reload-editor-button"
              className="rounded-md bg-telkom-red px-3 py-1 text-xs font-semibold text-white shadow-xs hover:bg-telkom-red-dark shrink-0"
            >
              Reload Editor
            </button>
          )}
        </div>
      )}

      {/* Guidance Note */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs text-neutral-gray px-1 gap-2">
        <p>
          Drag the name field or use <kbd className="px-1 py-0.5 bg-zinc-100 border border-zinc-300 rounded font-mono">Arrow</kbd> keys (<kbd className="px-1 py-0.5 bg-zinc-100 border border-zinc-300 rounded font-mono">Shift</kbd> for faster move). Adjust width with slider or <kbd className="px-1 py-0.5 bg-zinc-100 border border-zinc-300 rounded font-mono">[</kbd> / <kbd className="px-1 py-0.5 bg-zinc-100 border border-zinc-300 rounded font-mono">]</kbd>.
        </p>
        <p className="italic text-zinc-500 text-[11px]">
          The preview uses the selected font. The final PDF uses measured font metrics.
        </p>
      </div>

      {/* Main Dedicated Certificate Surface */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-100 p-2 sm:p-6 flex items-center justify-center overflow-hidden">
        <div
          ref={surfaceRef}
          data-testid="certificate-preview-surface"
          style={{ aspectRatio }}
          className="relative w-full max-w-4xl bg-white shadow-md rounded overflow-hidden select-none"
        >
          {/* Background Layer: PDF Canvas or Image */}
          {template.fileType === "PDF" ? (
            <div className="absolute inset-0 w-full h-full flex items-center justify-center">
              <canvas
                ref={canvasRef}
                data-testid="template-canvas-pdf"
                className="w-full h-full block pointer-events-none"
              />
              {!pdfRendered && !pdfError && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                  <p className="text-xs text-zinc-500 animate-pulse font-medium">
                    Rendering PDF preview...
                  </p>
                </div>
              )}
              {pdfError && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-50 p-4 text-center">
                  <p className="text-xs text-telkom-red-dark">
                    Failed to render PDF: {pdfError}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 w-full h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                data-testid="template-preview-image-surface"
                src={previewUrl}
                alt={template.name}
                className="w-full h-full object-contain pointer-events-none select-none"
              />
            </div>
          )}

          {/* Interactive Participant-Name Placement Overlay */}
          {surfaceSize.width > 0 && <Rnd
            bounds="parent"
            disableDragging={!isDraft}
            enableResizing={isDraft ? { left: true, right: true } : false}
            minWidth={surfaceSize.width * 0.1}
            maxWidth={surfaceSize.width}
            size={{ width: pixelPlacement.width, height: boxHeight }}
            position={{ x: pixelPlacement.left, y: Math.max(0, Math.min(surfaceSize.height - boxHeight, pixelPlacement.centerY - boxHeight / 2)) }}
            onDragStop={(_event, data) => { setPlacement(pixelToRatioPlacement(data.x + pixelPlacement.width / 2, data.y + boxHeight / 2, pixelPlacement.width, surfaceSize.width, surfaceSize.height, placement.alignment)); setSaveSuccess(false); }}
            onResizeStop={(_event, _direction, element, _delta, position) => { const width = element.offsetWidth; setPlacement(pixelToRatioPlacement(position.x + width / 2, position.y + boxHeight / 2, width, surfaceSize.width, surfaceSize.height, placement.alignment)); setSaveSuccess(false); }}
            style={{ zIndex: 1 }}
          ><div
            tabIndex={isDraft ? 0 : -1}
            role="region"
            aria-label="Participant name placement area. Drag or use arrow keys to position."
            data-testid="participant-name-overlay"
            onKeyDown={handleKeyDown}
            className="flex h-full w-full items-center cursor-move select-none rounded border-2 border-dashed border-telkom-red/80 bg-telkom-red/5 focus:outline-none focus:ring-2 focus:ring-telkom-red"
          >
            {/* Center Anchor Point Indicator */}
            <div
              className="absolute w-2 h-2 rounded-full bg-telkom-red pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{ left: "50%", top: "50%" }}
              title="Center anchor"
            />

            {/* Realistic Sample Participant Name */}
            <span className="pointer-events-none w-full px-2 text-charcoal" style={{ fontFamily: selectedFont ? `"DM Sans Preview"` : "inherit", fontWeight: selectedFont?.weight, fontStyle: selectedFont?.style, fontSize: `${fontSize * surfaceSize.width / pageWidth}px`, textAlign: placement.alignment }}>
              Nama Lengkap Peserta
            </span>
          </div></Rnd>}
        </div>
      </div>
    </div>
  );
}
