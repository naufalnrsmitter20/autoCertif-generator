"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDisplayDate } from "@/lib/date";
import { MAX_TEMPLATE_FILE_SIZE_BYTES } from "@/lib/storage/constants";
import { uploadCandidateToSignedUrl } from "@/lib/storage/client";

export type TemplateFileType = "PDF" | "PNG" | "JPG";
export type BatchStatus = "DRAFT" | "READY" | "GENERATING" | "GENERATED" | "PUBLISHED" | "FAILED";

export interface TemplateData {
  id: string;
  name: string;
  fileType: TemplateFileType;
  pageWidth: number | null;
  pageHeight: number | null;
  sourceFilePath?: string | null;
  createdAt: Date | string;
}

interface TemplateSectionProps {
  batchId: string;
  batchStatus: BatchStatus;
  initialTemplate: TemplateData | null;
}

type UploadStep = "idle" | "authorizing" | "uploading" | "validating" | "success";

export function TemplateSection({
  batchId,
  batchStatus,
  initialTemplate,
}: TemplateSectionProps) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateData | null>(initialTemplate);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStep, setUploadStep] = useState<UploadStep>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(Boolean(initialTemplate));
  const [, startTransition] = useTransition();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Load preview URL when template is available
  useEffect(() => {
    let ignore = false;

    if (!template?.id) {
      return;
    }

    fetch(`/api/admin/batches/${batchId}/template/preview`)
      .then((r) => r.json())
      .then((res) => {
        if (!ignore) {
          if (res.success && res.signedUrl) {
            setPreviewUrl(res.signedUrl);
          } else {
            setPreviewUrl(null);
          }
        }
      })
      .catch(() => {
        if (!ignore) setPreviewUrl(null);
      })
      .finally(() => {
        if (!ignore) setLoadingPreview(false);
      });

    return () => {
      ignore = true;
    };
  }, [template?.id, batchId]);

  const isDraft = batchStatus === "DRAFT";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Preliminary client validation
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    const validExtensions = [".pdf", ".png", ".jpg", ".jpeg"];
    if (!validExtensions.includes(ext)) {
      setErrorMessage("Please select a valid single-page PDF, PNG, or JPG/JPEG file.");
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_TEMPLATE_FILE_SIZE_BYTES) {
      setErrorMessage(
        `File size exceeds technical maximum of ${
          MAX_TEMPLATE_FILE_SIZE_BYTES / (1024 * 1024)
        } MB.`
      );
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setErrorMessage(null);

    // Map MIME type
    let mimeType: "application/pdf" | "image/png" | "image/jpeg";
    const ext = selectedFile.name.slice(selectedFile.name.lastIndexOf(".")).toLowerCase();
    if (ext === ".pdf") {
      mimeType = "application/pdf";
    } else if (ext === ".png") {
      mimeType = "image/png";
    } else {
      mimeType = "image/jpeg";
    }

    try {
      // Step 1: Request signed upload permission
      setUploadStep("authorizing");
      const initRes = await fetch(`/api/admin/batches/${batchId}/template/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selectedFile.name,
          mimeType,
          size: selectedFile.size,
        }),
      }).then((r) => r.json());

      console.log("INIT RES:", initRes);

      if (!initRes.success || !initRes.signedUrl || !initRes.token || !initRes.storagePath) {
        throw new Error(initRes.error || "Failed to initiate template upload.");
      }

      // Step 2: Direct browser upload to Supabase Storage
      setUploadStep("uploading");
      await uploadCandidateToSignedUrl(
        initRes.storagePath,
        initRes.token,
        selectedFile
      );

      // Step 3: Server byte validation and persistence
      setUploadStep("validating");
      const finalizeRes = await fetch(`/api/admin/batches/${batchId}/template/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: initRes.storagePath,
          originalFilename: selectedFile.name,
          declaredMimeType: mimeType,
        }),
      }).then((r) => r.json());

      if (!finalizeRes.success || !finalizeRes.template) {
        throw new Error(finalizeRes.error || "Template finalization failed.");
      }

      setUploadStep("success");
      setPreviewUrl(null);
      setLoadingPreview(true);
      setTemplate({
        id: finalizeRes.template.id,
        name: finalizeRes.template.name,
        fileType: finalizeRes.template.fileType as TemplateFileType,
        pageWidth: finalizeRes.template.pageWidth,
        pageHeight: finalizeRes.template.pageHeight,
        createdAt: new Date(),
      });
      setSelectedFile(null);
      setShowReplaceDialog(false);

      if (fileInputRef.current) fileInputRef.current.value = "";
      if (replaceFileInputRef.current) replaceFileInputRef.current.value = "";
      router.refresh();
    } catch (err: unknown) {
      setUploadStep("idle");
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setErrorMessage(message);
    } finally {
      startTransition(() => {
        if (uploadStep === "success") {
          setUploadStep("idle");
        }
      });
    }
  };

  const cancelSelection = () => {
    setSelectedFile(null);
    setErrorMessage(null);
    setUploadStep("idle");
    setShowReplaceDialog(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (replaceFileInputRef.current) replaceFileInputRef.current.value = "";
  };

  const renderDimensions = (w: number | null, h: number | null, type: TemplateFileType) => {
    if (!w || !h) return "Unknown dimensions";
    if (type === "PDF") {
      return `${Math.round(w)} × ${Math.round(h)} pt`;
    }
    return `${Math.round(w)} × ${Math.round(h)} px`;
  };

  return (
    <div
      data-testid="template-management-section"
      className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Certificate Template
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Single-page background artwork for certificates in this batch.
          </p>
        </div>
        {template && isDraft && (
          <button
            type="button"
            data-testid="replace-template-button"
            onClick={() => {
              setShowReplaceDialog(true);
              setErrorMessage(null);
              setSelectedFile(null);
            }}
            className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-xs hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Replace Template
          </button>
        )}
      </div>

      {errorMessage && (
        <div
          data-testid="template-error-banner"
          role="alert"
          aria-live="assertive"
          className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-300"
        >
          {errorMessage}
        </div>
      )}

      {/* State 1: Active Template Configured */}
      {template && !showReplaceDialog ? (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-lg border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800/60 dark:bg-zinc-800/40">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Template Name
              </p>
              <p
                data-testid="template-display-name"
                className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate"
              >
                {template.name}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                File Type & Dimensions
              </p>
              <p
                data-testid="template-metadata-type-dimensions"
                className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              >
                <span className="inline-flex items-center rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-medium text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200 mr-2">
                  {template.fileType}
                </span>
                {renderDimensions(template.pageWidth, template.pageHeight, template.fileType)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Configured Date
              </p>
              <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {formatDisplayDate(template.createdAt)}
              </p>
            </div>
          </div>

          {/* Secure Short-Lived Preview */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-100 p-4 dark:border-zinc-800 dark:bg-zinc-950 flex flex-col items-center justify-center min-h-[300px]">
            {loadingPreview ? (
              <p className="text-sm text-zinc-500 animate-pulse">Loading secure preview...</p>
            ) : previewUrl ? (
              template.fileType === "PDF" ? (
                <div className="w-full flex flex-col items-center">
                  <object
                    data-testid="template-preview-pdf"
                    data={previewUrl}
                    type="application/pdf"
                    className="w-full h-[450px] rounded border border-zinc-300 dark:border-zinc-700"
                  >
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 p-4 text-center">
                      PDF preview not supported directly in this browser.{" "}
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-900 underline font-medium dark:text-zinc-100"
                      >
                        Open PDF Preview in New Tab
                      </a>
                    </p>
                  </object>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 text-xs text-zinc-600 hover:text-zinc-900 underline dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    Open PDF in New Window
                  </a>
                </div>
              ) : (
                <div className="max-w-full overflow-hidden flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    data-testid="template-preview-image"
                    src={previewUrl}
                    alt={template.name}
                    className="max-h-[450px] w-auto rounded object-contain shadow-xs border border-zinc-200 dark:border-zinc-800"
                  />
                </div>
              )
            ) : (
              <p className="text-sm text-zinc-500">
                Preview unavailable. Please refresh or verify storage configuration.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* State 2: Replacement Confirmation & Form */}
      {template && showReplaceDialog && (
        <div
          data-testid="replace-confirmation-modal"
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Replace Certificate Template
              </h3>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Uploading a replacement will soft-delete the current template for this batch.
                The existing template remains active until the new upload is validated and confirmed.
              </p>
            </div>
            <button
              type="button"
              onClick={cancelSelection}
              disabled={uploadStep !== "idle"}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            >
              Cancel
            </button>
          </div>

          <div className="mt-4">
            <input
              ref={replaceFileInputRef}
              type="file"
              data-testid="replace-template-file-input"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={handleFileChange}
              disabled={uploadStep !== "idle"}
              className="block w-full text-xs text-zinc-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-900 file:text-white hover:file:bg-zinc-800 dark:text-zinc-400 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-zinc-200"
            />
          </div>

          {selectedFile && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">
                {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelSelection}
                  disabled={uploadStep !== "idle"}
                  className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="confirm-replace-template-button"
                  onClick={handleUpload}
                  disabled={uploadStep !== "idle"}
                  className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-amber-500 disabled:opacity-50"
                >
                  {uploadStep === "authorizing"
                    ? "Authorizing..."
                    : uploadStep === "uploading"
                    ? "Uploading to Storage..."
                    : uploadStep === "validating"
                    ? "Validating File..."
                    : "Confirm & Replace"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* State 3: No Template Configured — Initial Upload Dropzone */}
      {!template && (
        <div className="mt-6">
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
            <svg
              className="h-10 w-10 text-zinc-400 dark:text-zinc-500 mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>

            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              <label
                htmlFor="template-file-upload"
                className="relative cursor-pointer rounded-md font-semibold text-zinc-900 focus-within:outline-none focus-within:ring-2 focus-within:ring-zinc-900 focus-within:ring-offset-2 hover:text-zinc-700 dark:text-zinc-100 dark:hover:text-zinc-300"
              >
                <span>Upload a certificate template</span>
                <input
                  id="template-file-upload"
                  ref={fileInputRef}
                  type="file"
                  data-testid="template-file-input"
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  onChange={handleFileChange}
                  disabled={uploadStep !== "idle" || !isDraft}
                  className="sr-only"
                />
              </label>
              <p className="pl-1">or select file from disk</p>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              Single-page PDF, PNG, or JPG/JPEG up to 10 MB
            </p>
          </div>

          {selectedFile && (
            <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-850 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelSelection}
                  disabled={uploadStep !== "idle"}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="submit-template-upload-button"
                  onClick={handleUpload}
                  disabled={uploadStep !== "idle"}
                  className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {uploadStep === "authorizing"
                    ? "Authorizing..."
                    : uploadStep === "uploading"
                    ? "Uploading to Storage..."
                    : uploadStep === "validating"
                    ? "Validating File..."
                    : "Upload Template"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
