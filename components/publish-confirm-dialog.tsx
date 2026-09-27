"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { PublishPreflightData } from "@/lib/publication/types";

interface PublishConfirmDialogProps {
  batchId: string;
  expectedCurrentGenerationKey: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PublishConfirmDialog({
  batchId,
  expectedCurrentGenerationKey,
  isOpen,
  onClose,
  onSuccess,
}: PublishConfirmDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isLoadingPreflight, setIsLoadingPreflight] = useState(false);
  const [preflightData, setPreflightData] = useState<PublishPreflightData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch preflight when dialog opens
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    async function loadPreflight() {
      setIsLoadingPreflight(true);
      setErrorMessage(null);

      try {
        const res = await fetch(`/api/admin/batches/${batchId}/publish`);
        const data = await res.json();
        if (!isMounted) return;
        if (!data.success) {
          setErrorMessage(data.error || "Failed to load publication preflight.");
        } else {
          setPreflightData(data.data);
        }
      } catch (err) {
        if (!isMounted) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load publication preflight."
        );
      } finally {
        if (isMounted) {
          setIsLoadingPreflight(false);
        }
      }
    }

    void loadPreflight();

    return () => {
      isMounted = false;
      setPreflightData(null);
      setErrorMessage(null);
    };
  }, [isOpen, batchId]);

  const handleConfirm = () => {
    setErrorMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/batches/${batchId}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedCurrentGenerationKey }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setErrorMessage(data.error || "Failed to publish batch.");
        } else {
          onClose();
          if (onSuccess) onSuccess();
          router.refresh();
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to publish batch."
        );
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h3
          id="publish-dialog-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
        >
          Publish Certificate Batch
        </h3>

        {isLoadingPreflight && (
          <div className="py-8 flex flex-col items-center justify-center text-sm text-zinc-600 dark:text-zinc-400 gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-telkom-red border-t-transparent" />
            <p>Checking publication eligibility...</p>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
          >
            {errorMessage}
          </div>
        )}

        {!isLoadingPreflight && preflightData && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Publishing will make eligible certificates searchable and downloadable by the public.
            </p>

            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-600 dark:text-zinc-400">Eligible certificates to publish:</span>
                <span
                  data-testid="publish-eligible-count"
                  className="font-semibold text-emerald-700 dark:text-emerald-400"
                >
                  {preflightData.eligibleCount} of {preflightData.totalParticipants}
                </span>
              </div>
              {preflightData.failedCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Failed / unavailable participants:</span>
                  <span
                    data-testid="publish-failed-count"
                    className="font-semibold text-rose-700 dark:text-rose-400"
                  >
                    {preflightData.failedCount}
                  </span>
                </div>
              )}
            </div>

            {preflightData.failedCount > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                <p className="font-medium">
                  {preflightData.failedCount} participant{preflightData.failedCount === 1 ? "" : "s"} will remain unavailable publicly:
                </p>
                <div className="max-h-28 overflow-y-auto rounded border border-amber-200 bg-white/70 p-2 dark:border-amber-800 dark:bg-zinc-900/50">
                  <ul className="list-disc list-inside space-y-0.5 font-mono text-[11px]">
                    {preflightData.failedParticipantNames.map((name, idx) => (
                      <li key={idx} className="truncate">
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  Successful participants can still be published without waiting for failed ones.
                </p>
              </div>
            )}

            {!preflightData.canPublish && (
              <p className="text-xs text-rose-600 font-medium">
                No certificates are currently eligible to be published. Please resolve errors before publishing.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            data-testid="cancel-publish-button"
            disabled={isPending}
            onClick={() => {
              setPreflightData(null);
              setErrorMessage(null);
              onClose();
            }}
            className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-publish-button"
            disabled={isPending || isLoadingPreflight || !preflightData?.canPublish}
            onClick={handleConfirm}
            className="inline-flex min-h-[38px] items-center justify-center rounded-md bg-telkom-red hover:bg-telkom-red-dark px-4 py-2 text-xs font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-telkom-red transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isPending ? "Publishing..." : "Confirm Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
