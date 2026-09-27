"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDisplayDate } from "@/lib/date";
import { PublishConfirmDialog } from "@/components/publish-confirm-dialog";
import { UnpublishConfirmDialog } from "@/components/unpublish-confirm-dialog";
export type BatchStatus = "DRAFT" | "READY" | "GENERATING" | "GENERATED" | "PUBLISHED" | "FAILED";
import type { BatchGenerationSummary } from "@/lib/batches";

interface GenerationSectionProps {
  batchId: string;
  batchStatus: BatchStatus;
  hasTemplate: boolean;
  hasPlacement: boolean;
  participantCount: number;
  publishedAt?: Date | string | null;
  currentGenerationKey?: string | null;
  summary?: BatchGenerationSummary;
}

export function GenerationSection({
  batchId,
  batchStatus,
  hasTemplate,
  hasPlacement,
  participantCount,
  publishedAt,
  currentGenerationKey,
  summary,
}: GenerationSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [isUnpublishDialogOpen, setIsUnpublishDialogOpen] = useState(false);

  const isBatchPublished = publishedAt !== null && publishedAt !== undefined;

  // Poll for status updates while batch is actively GENERATING
  useEffect(() => {
    if (batchStatus !== "GENERATING") return;

    const interval = setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [batchStatus, router]);

  const canTrigger =
    batchStatus === "DRAFT" &&
    hasTemplate &&
    hasPlacement &&
    participantCount > 0;

  const handleTrigger = () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/batches/${batchId}/generation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trigger" }),
        });
        let data: { success?: boolean; message?: string; error?: string } = {};
        try {
          data = await res.json();
        } catch {
          data = { error: `Server error (${res.status})` };
        }
        if (!res.ok || !data.success) {
          setErrorMessage(data.error || "Failed to start generation.");
        } else {
          setSuccessMessage(data.message || "Generation initiated.");
          router.refresh();
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to trigger generation.");
      }
    });
  };

  const handleResume = () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/batches/${batchId}/generation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resume" }),
        });
        let data: { success?: boolean; message?: string; error?: string } = {};
        try {
          data = await res.json();
        } catch {
          data = { error: `Server error (${res.status})` };
        }
        if (!res.ok || !data.success) {
          setErrorMessage(data.error || "Failed to resume generation.");
        } else {
          setSuccessMessage(data.message || "Generation re-enqueued.");
          router.refresh();
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to resume generation.");
      }
    });
  };

  return (
    <div
      data-testid="generation-section"
      className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Certificate Generation
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Render and persist individual participant certificates in the background.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div
          data-testid="generation-error-banner"
          className="mt-4 rounded-md bg-rose-50 p-4 border border-rose-200 text-sm text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200"
        >
          <p className="font-medium">Generation Error</p>
          <p className="mt-1 text-xs">{errorMessage}</p>
        </div>
      )}

      {successMessage && (
        <div
          data-testid="generation-success-banner"
          className="mt-4 rounded-md bg-emerald-50 p-4 border border-emerald-200 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200"
        >
          <p className="font-medium">{successMessage}</p>
        </div>
      )}

      {/* DRAFT STATE: Preconditions & Trigger */}
      {batchStatus === "DRAFT" && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
            <div className="flex items-center gap-2 rounded border border-zinc-200 p-2.5 dark:border-zinc-800">
              <span className={hasTemplate ? "text-emerald-600" : "text-zinc-400"}>
                {hasTemplate ? "✓" : "○"}
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">
                Template: {hasTemplate ? "Configured" : "Missing"}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded border border-zinc-200 p-2.5 dark:border-zinc-800">
              <span className={hasPlacement ? "text-emerald-600" : "text-zinc-400"}>
                {hasPlacement ? "✓" : "○"}
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">
                Name Position: {hasPlacement ? "Configured" : "Missing"}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded border border-zinc-200 p-2.5 dark:border-zinc-800">
              <span className={participantCount > 0 ? "text-emerald-600" : "text-zinc-400"}>
                {participantCount > 0 ? "✓" : "○"}
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">
                Participants: {participantCount}
              </span>
            </div>
          </div>

          <div>
            <button
              type="button"
              data-testid="generate-certificates-button"
              disabled={!canTrigger || isPending}
              onClick={handleTrigger}
              className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-telkom-red ${
                canTrigger && !isPending
                  ? "bg-telkom-red hover:bg-telkom-red-dark cursor-pointer"
                  : "bg-zinc-300 dark:bg-zinc-700 cursor-not-allowed opacity-60"
              }`}
            >
              {isPending ? "Starting Generation..." : "Generate Certificates"}
            </button>
            {!canTrigger && (
              <p className="mt-2 text-xs text-zinc-500">
                Complete template upload, name positioning, and import at least 1 participant to enable generation.
              </p>
            )}
          </div>
        </div>
      )}

      {/* GENERATING STATE: In progress / Polling / Recovery */}
      {batchStatus === "GENERATING" && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3 rounded-md bg-amber-50 p-4 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-900">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
            <div className="text-sm text-amber-900 dark:text-amber-200">
              <p className="font-semibold">
                {isBatchPublished ? "Updating published batch..." : "Generation in progress..."}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {isBatchPublished
                  ? "Participants are rendering in the background. Previously published certificates remain live."
                  : "Participants are rendering in the background. Status will refresh automatically."}
              </p>
            </div>
          </div>

          {summary && summary.total > 0 && (
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <div className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
                <span className="text-xs text-zinc-500">Total</span>
                <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {summary.total}
                </p>
              </div>
              <div className="rounded border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900">
                <span className="text-xs text-amber-700 dark:text-amber-300">Processing</span>
                <p className="text-lg font-bold text-amber-800 dark:text-amber-200">
                  {summary.pending + summary.generating}
                </p>
              </div>
              <div className="rounded border border-emerald-200 bg-emerald-50/50 p-2 dark:border-emerald-900">
                <span className="text-xs text-emerald-700 dark:text-emerald-300">Generated</span>
                <p className="text-lg font-bold text-emerald-800 dark:text-emerald-200">
                  {summary.generated}
                </p>
              </div>
              <div className="rounded border border-rose-200 bg-rose-50/50 p-2 dark:border-rose-900">
                <span className="text-xs text-rose-700 dark:text-rose-300">Failed</span>
                <p className="text-lg font-bold text-rose-800 dark:text-rose-200">
                  {summary.failed}
                </p>
              </div>
            </div>
          )}

          {/* Recovery button if all are PENDING */}
          {summary && summary.pending === summary.total && summary.total > 0 && (
            <div className="pt-2">
              <button
                type="button"
                data-testid="resume-generation-button"
                disabled={isPending}
                onClick={handleResume}
                className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 transition-colors"
              >
                {isPending ? "Resuming..." : "Resume Dispatch"}
              </button>
              <p className="mt-1 text-xs text-zinc-500">
                Use if background workers have not started processing pending participants.
              </p>
            </div>
          )}
        </div>
      )}

      {/* GENERATED / PUBLISHED STATE: Completed summary & publication actions */}
      {(batchStatus === "GENERATED" || batchStatus === "PUBLISHED") && summary && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <div className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
              <span className="text-xs text-zinc-500">Total</span>
              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {summary.total}
              </p>
            </div>
            <div className="rounded border border-emerald-200 bg-emerald-50/50 p-2 dark:border-emerald-900">
              <span className="text-xs text-emerald-700 dark:text-emerald-300">Generated</span>
              <p className="text-lg font-bold text-emerald-800 dark:text-emerald-200">
                {summary.generated}
              </p>
            </div>
            <div className="rounded border border-rose-200 bg-rose-50/50 p-2 dark:border-rose-900">
              <span className="text-xs text-rose-700 dark:text-rose-300">Failed</span>
              <p className="text-lg font-bold text-rose-800 dark:text-rose-200">
                {summary.failed}
              </p>
            </div>
            <div className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
              <span className="text-xs text-zinc-500">Status</span>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mt-1">
                {isBatchPublished ? "Published" : "Completed"}
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              {isBatchPublished ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    ● Live / Published
                  </span>
                  {publishedAt && (
                    <span className="text-xs text-zinc-500">
                      Since {formatDisplayDate(new Date(publishedAt))}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  All participants reached terminal status.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isBatchPublished ? (
                <button
                  type="button"
                  data-testid="open-unpublish-dialog-button"
                  onClick={() => setIsUnpublishDialogOpen(true)}
                  className="inline-flex min-h-[36px] items-center justify-center rounded-md border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                >
                  Unpublish
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="open-publish-dialog-button"
                  onClick={() => setIsPublishDialogOpen(true)}
                  className="inline-flex min-h-[36px] items-center justify-center rounded-md bg-telkom-red hover:bg-telkom-red-dark px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-telkom-red transition-colors cursor-pointer"
                >
                  Publish Batch
                </button>
              )}

              <Link
                href={`/admin/batches/${batchId}/generation`}
                data-testid="manage-generation-link"
                className="inline-flex min-h-[36px] items-center justify-center rounded-md border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 transition-colors"
              >
                Manage Generation &rarr;
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* FAILED STATE: Batch-level orchestration crash */}
      {batchStatus === "FAILED" && (
        <div className="mt-4 rounded-md bg-rose-50 p-4 border border-rose-200 text-sm text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200 space-y-2">
          <p className="font-semibold">Batch Generation Failed</p>
          <p className="text-xs">
            An unrecoverable system orchestration failure occurred while dispatching jobs.
          </p>
          <div className="pt-1">
            <Link
              href={`/admin/batches/${batchId}/generation`}
              data-testid="manage-generation-link-failed"
              className="inline-flex min-h-[34px] items-center justify-center rounded-md bg-rose-600 hover:bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-rose-600 transition-colors"
            >
              Open Generation Management &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Publish and Unpublish Confirmation Dialogs */}
      <PublishConfirmDialog
        batchId={batchId}
        expectedCurrentGenerationKey={currentGenerationKey ?? null}
        isOpen={isPublishDialogOpen}
        onClose={() => setIsPublishDialogOpen(false)}
        onSuccess={() => router.refresh()}
      />

      <UnpublishConfirmDialog
        batchId={batchId}
        isOpen={isUnpublishDialogOpen}
        onClose={() => setIsUnpublishDialogOpen(false)}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}
