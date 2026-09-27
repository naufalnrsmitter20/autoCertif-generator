"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BatchStatusBadge } from "@/components/batch-status-badge";
import { CertificateStatusBadge } from "@/components/certificate-status-badge";
import { formatDisplayDate } from "@/lib/date";
import { PublishConfirmDialog } from "@/components/publish-confirm-dialog";
import { UnpublishConfirmDialog } from "@/components/unpublish-confirm-dialog";
import { EditPublishedParticipantDialog } from "@/components/edit-published-participant-dialog";
import type {
  BatchGenerationManagementData,
  ManagementCertificateRow,
} from "@/lib/generation/types";

interface GenerationManagementClientProps {
  initialData: BatchGenerationManagementData;
}

type FilterTab = "ALL" | "FAILED" | "GENERATED" | "IN_PROGRESS";

function formatSafeErrorMessage(rawError: string | null): string {
  if (!rawError) return "";
  if (rawError.startsWith("NAME_DOES_NOT_FIT")) {
    return "Name could not fit safely within configured certificate area.";
  }
  if (rawError.startsWith("UNSUPPORTED_GLYPH")) {
    const detail = rawError.replace(/^UNSUPPORTED_GLYPH:\s*/, "");
    return `Font does not support character: ${detail}`;
  }
  if (rawError.startsWith("INFRASTRUCTURE_FAILURE")) {
    return "System processing error: retry limit exceeded.";
  }
  return "Generation failed to complete safely.";
}

export function GenerationManagementClient({
  initialData,
}: GenerationManagementClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");
  const [isConfirmRegenBatchOpen, setIsConfirmRegenBatchOpen] = useState(false);
  const [activeActionParticipantId, setActiveActionParticipantId] = useState<string | null>(null);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [isUnpublishDialogOpen, setIsUnpublishDialogOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<ManagementCertificateRow | null>(null);

  const { batch, summary, participants } = initialData;
  const isGenerating = batch.status === "GENERATING";
  const isBatchPublished = batch.publishedAt !== null;

  // Auto-polling: poll every 3 seconds only while batch is GENERATING
  useEffect(() => {
    if (!isGenerating) return;

    const interval = setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [isGenerating, router]);

  // Filter participants
  const filteredParticipants = useMemo(() => {
    return participants.filter((p: ManagementCertificateRow) => {
      if (filterTab === "ALL") return true;
      if (filterTab === "FAILED") return p.certificateStatus === "FAILED";
      if (filterTab === "GENERATED") return p.certificateStatus === "GENERATED";
      if (filterTab === "IN_PROGRESS") {
        return (
          p.certificateStatus === "PENDING" ||
          p.certificateStatus === "GENERATING"
        );
      }
      return true;
    });
  }, [participants, filterTab]);

  const handleAction = async (
    action:
      | "retry-participant"
      | "regenerate-participant"
      | "regenerate-batch"
      | "recover-batch"
      | "retry-published-replacement",
    participantId?: string
  ) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (participantId) setActiveActionParticipantId(participantId);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/batches/${batch.id}/generation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            participantId,
            expectedCurrentGenerationKey: batch.currentGenerationKey,
          }),
        });

        let data: { success?: boolean; message?: string; error?: string } = {};
        try {
          data = await res.json();
        } catch {
          data = { error: `Server error (${res.status})` };
        }

        if (!res.ok || !data.success) {
          setErrorMessage(data.error || "Action failed to execute.");
        } else {
          setSuccessMessage(data.message || "Action successfully started.");
          setIsConfirmRegenBatchOpen(false);
          router.refresh();
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to execute action.");
      } finally {
        setActiveActionParticipantId(null);
      }
    });
  };

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header & Navigation */}
      <div>
        <Link
          href={`/admin/batches/${batch.id}`}
          className="inline-flex items-center text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 mb-3 focus:outline-none focus:ring-2 focus:ring-zinc-900 rounded px-1"
        >
          &larr; Back to Batch Details
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1
              data-testid="generation-page-title"
              className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100"
            >
              Generation Management
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Batch: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{batch.name}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isBatchPublished && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                ● Published
              </span>
            )}
            <BatchStatusBadge status={batch.status} />
            {isBatchPublished ? (
              <button
                type="button"
                data-testid="unpublish-batch-header-button"
                disabled={isPending}
                onClick={() => setIsUnpublishDialogOpen(true)}
                className="inline-flex min-h-[36px] items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
              >
                Unpublish
              </button>
            ) : batch.status === "GENERATED" ? (
              <button
                type="button"
                data-testid="publish-batch-header-button"
                disabled={isPending || isGenerating}
                onClick={() => setIsPublishDialogOpen(true)}
                className="inline-flex min-h-[36px] items-center justify-center rounded-md bg-telkom-red hover:bg-telkom-red-dark px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-telkom-red transition-colors cursor-pointer"
              >
                Publish Batch
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div
          data-testid="management-error-banner"
          className="rounded-md bg-rose-50 p-4 border border-rose-200 text-sm text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200"
        >
          <p className="font-medium">Action Conflict or Error</p>
          <p className="mt-1 text-xs">{errorMessage}</p>
        </div>
      )}

      {successMessage && (
        <div
          data-testid="management-success-banner"
          className="rounded-md bg-emerald-50 p-4 border border-emerald-200 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200"
        >
          <p className="font-medium">{successMessage}</p>
        </div>
      )}

      {/* Generating Banner */}
      {isGenerating && (
        <div className="flex items-center gap-3 rounded-md bg-amber-50 p-4 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-900">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold">Generation actively in progress...</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Participant certificates are rendering in the background. Page refreshes automatically every 3s.
            </p>
          </div>
        </div>
      )}

      {/* FAILED State Recovery Banner */}
      {batch.status === "FAILED" && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="font-semibold text-rose-900 dark:text-rose-200">
              Orchestration Failure Detected
            </p>
            <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
              The previous batch operation was interrupted. You can recover only unfinished participants.
            </p>
          </div>
          <button
            type="button"
            data-testid="recover-batch-button"
            disabled={isPending}
            onClick={() => handleAction("recover-batch")}
            className="inline-flex min-h-[40px] items-center justify-center rounded-md bg-rose-600 hover:bg-rose-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-rose-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isPending ? "Recovering..." : "Recover Generation"}
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Total Participants</span>
          <p data-testid="summary-total" className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {summary.total}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 shadow-xs dark:border-emerald-900 dark:bg-emerald-950/20">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Generated</span>
          <p data-testid="summary-generated" className="text-2xl font-bold text-emerald-800 dark:text-emerald-200 mt-1">
            {summary.generated}
          </p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-4 shadow-xs dark:border-rose-900 dark:bg-rose-950/20">
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">Failed</span>
          <p data-testid="summary-failed" className="text-2xl font-bold text-rose-800 dark:text-rose-200 mt-1">
            {summary.failed}
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 shadow-xs dark:border-amber-900 dark:bg-amber-950/20">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">In Progress</span>
          <p data-testid="summary-in-progress" className="text-2xl font-bold text-amber-800 dark:text-amber-200 mt-1">
            {summary.pending + summary.generating}
          </p>
        </div>
      </div>

      {/* Action Bar & Filtering */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Filter Pills */}
          <div className="flex flex-wrap gap-1.5" data-testid="status-filter-group">
            <button
              type="button"
              data-testid="filter-all"
              onClick={() => setFilterTab("ALL")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filterTab === "ALL"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              All ({summary.total})
            </button>
            <button
              type="button"
              data-testid="filter-failed"
              onClick={() => setFilterTab("FAILED")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filterTab === "FAILED"
                  ? "bg-rose-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              Failed ({summary.failed})
            </button>
            <button
              type="button"
              data-testid="filter-generated"
              onClick={() => setFilterTab("GENERATED")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filterTab === "GENERATED"
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              Generated ({summary.generated})
            </button>
            <button
              type="button"
              data-testid="filter-in-progress"
              onClick={() => setFilterTab("IN_PROGRESS")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filterTab === "IN_PROGRESS"
                  ? "bg-amber-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              In Progress ({summary.pending + summary.generating})
            </button>
          </div>

          {/* Regenerate Batch Trigger */}
          {batch.status === "GENERATED" && (
            <div>
              <button
                type="button"
                data-testid="open-regenerate-batch-dialog-button"
                disabled={isGenerating || isPending || summary.total === 0}
                onClick={() => setIsConfirmRegenBatchOpen(true)}
                className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Regenerate Whole Batch
              </button>
            </div>
          )}
        </div>

        {/* Confirmation Container for Whole-Batch Regeneration */}
        {isConfirmRegenBatchOpen && (
          <div
            data-testid="regenerate-batch-confirmation-container"
            className="rounded-md border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30 space-y-3"
          >
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Confirm Whole-Batch Regeneration
            </p>
            <ul className="text-xs text-amber-800 dark:text-amber-300 list-disc list-inside space-y-1">
              <li>All {summary.total} active participant certificates will be queued for regeneration.</li>
              <li>Existing successful output files remain preserved until new outputs succeed.</li>
              <li>Processing runs in the background and may take a few moments.</li>
            </ul>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                data-testid="confirm-regenerate-batch-button"
                disabled={isPending}
                onClick={() => handleAction("regenerate-batch")}
                className="inline-flex min-h-[36px] items-center justify-center rounded-md bg-telkom-red hover:bg-telkom-red-dark px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-telkom-red disabled:opacity-50 cursor-pointer"
              >
                {isPending ? "Starting..." : "Yes, Regenerate Batch"}
              </button>
              <button
                type="button"
                data-testid="cancel-regenerate-batch-button"
                disabled={isPending}
                onClick={() => setIsConfirmRegenBatchOpen(false)}
                className="inline-flex min-h-[36px] items-center justify-center rounded-md border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Participants Table */}
      <div className="rounded-lg border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800 text-left text-xs">
            <thead className="bg-zinc-50 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3">Participant</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Last Generated</th>
                <th scope="col" className="px-4 py-3">Failure Details / State</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
              {filteredParticipants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No participants found matching &quot;{filterTab.toLowerCase()}&quot; filter.
                  </td>
                </tr>
              ) : (
                filteredParticipants.map((p) => {
                  const isRowPending =
                    isPending && activeActionParticipantId === p.participantId;
                  const canRetry =
                    batch.status === "GENERATED" &&
                    p.certificateStatus === "FAILED" &&
                    !isGenerating;
                  const canRegenerate =
                    batch.status === "GENERATED" &&
                    p.certificateStatus === "GENERATED" &&
                    !isGenerating;
                  const canEditPublishedName =
                    (batch.status === "PUBLISHED" || isBatchPublished) &&
                    !isGenerating;
                  const canRetryPublishedReplacement =
                    (batch.status === "PUBLISHED" || isBatchPublished) &&
                    p.certificateStatus === "FAILED" &&
                    p.isStale &&
                    !isGenerating;

                  return (
                    <tr
                      key={p.participantId}
                      data-testid={`participant-row-${p.participantId}`}
                      className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      {/* Name */}
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                        <div>{p.name}</div>
                        {p.publishedName && (
                          <div
                            data-testid={`published-name-subtext-${p.participantId}`}
                            className="text-[11px] text-zinc-500 font-normal mt-0.5"
                          >
                            Published as: <span className={`font-semibold ${p.publishedName !== p.name ? "text-amber-700 dark:text-amber-400" : "text-zinc-700 dark:text-zinc-300"}`}>&quot;{p.publishedName}&quot;</span>
                            {p.publishedName !== p.name && (
                              <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium">(Update pending)</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <CertificateStatusBadge status={p.certificateStatus} />
                      </td>

                      {/* Last Generated */}
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        {p.generatedAt ? formatDisplayDate(new Date(p.generatedAt)) : "—"}
                      </td>

                      {/* Failure / Stale details */}
                      <td className="px-4 py-3">
                        {p.certificateStatus === "FAILED" && p.safeGenerationError ? (
                          <div className="space-y-0.5">
                            <p
                              data-testid={`failure-reason-${p.participantId}`}
                              className="font-medium text-rose-700 dark:text-rose-400"
                            >
                              {formatSafeErrorMessage(p.safeGenerationError)}
                            </p>
                            <p className="text-[10px] text-zinc-500 font-mono">
                              {p.safeGenerationError}
                            </p>
                          </div>
                        ) : null}

                        {p.isStale && (
                          <span
                            data-testid={`stale-badge-${p.participantId}`}
                            className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          >
                            Stale (previous certificate preserved)
                          </span>
                        )}

                        {!p.safeGenerationError && !p.isStale && (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>

                      {/* Action Button */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {canRetry && (
                            <button
                              type="button"
                              data-testid={`retry-button-${p.participantId}`}
                              disabled={isPending || isGenerating}
                              onClick={() => handleAction("retry-participant", p.participantId)}
                              className="inline-flex min-h-[32px] items-center justify-center rounded border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-zinc-800 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {isRowPending ? "Retrying..." : "Retry"}
                            </button>
                          )}

                          {canRegenerate && (
                            <button
                              type="button"
                              data-testid={`regenerate-button-${p.participantId}`}
                              disabled={isPending || isGenerating}
                              onClick={() => handleAction("regenerate-participant", p.participantId)}
                              className="inline-flex min-h-[32px] items-center justify-center rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {isRowPending ? "Regenerating..." : "Regenerate"}
                            </button>
                          )}

                          {canRetryPublishedReplacement && (
                            <button
                              type="button"
                              data-testid={`retry-replacement-button-${p.participantId}`}
                              disabled={isPending || isGenerating}
                              onClick={() => handleAction("retry-published-replacement", p.participantId)}
                              className="inline-flex min-h-[32px] items-center justify-center rounded border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:bg-zinc-800 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {isRowPending ? "Retrying..." : "Retry Replacement"}
                            </button>
                          )}

                          {canEditPublishedName && (
                            <button
                              type="button"
                              data-testid={`edit-published-button-${p.participantId}`}
                              disabled={isPending || isGenerating}
                              onClick={() => setEditingParticipant(p)}
                              className="inline-flex min-h-[32px] items-center justify-center rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              Edit Name
                            </button>
                          )}

                          {!canRetry && !canRegenerate && !canEditPublishedName && !canRetryPublishedReplacement && (
                            <span className="text-zinc-400 text-xs">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Publish & Unpublish Dialogs */}
      <PublishConfirmDialog
        batchId={batch.id}
        expectedCurrentGenerationKey={batch.currentGenerationKey}
        isOpen={isPublishDialogOpen}
        onClose={() => setIsPublishDialogOpen(false)}
        onSuccess={() => router.refresh()}
      />

      <UnpublishConfirmDialog
        batchId={batch.id}
        isOpen={isUnpublishDialogOpen}
        onClose={() => setIsUnpublishDialogOpen(false)}
        onSuccess={() => router.refresh()}
      />

      {/* Edit Published Participant Dialog */}
      {editingParticipant && (
        <EditPublishedParticipantDialog
          batchId={batch.id}
          participantId={editingParticipant.participantId}
          currentName={editingParticipant.name}
          publishedName={editingParticipant.publishedName}
          expectedCurrentGenerationKey={batch.currentGenerationKey}
          isOpen={Boolean(editingParticipant)}
          onClose={() => setEditingParticipant(null)}
          onSuccess={() => router.refresh()}
        />
      )}
    </div>
  );
}
