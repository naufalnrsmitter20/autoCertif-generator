"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface UnpublishConfirmDialogProps {
  batchId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function UnpublishConfirmDialog({
  batchId,
  isOpen,
  onClose,
  onSuccess,
}: UnpublishConfirmDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConfirm = () => {
    setErrorMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/batches/${batchId}/unpublish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setErrorMessage(data.error || "Failed to unpublish batch.");
        } else {
          onClose();
          if (onSuccess) onSuccess();
          router.refresh();
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to unpublish batch."
        );
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unpublish-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h3
          id="unpublish-dialog-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
        >
          Unpublish Certificate Batch
        </h3>

        <div className="mt-3 space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
          <p>
            Unpublishing will immediately remove this batch and its certificates from public access.
          </p>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50 space-y-1">
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">
              Important details:
            </p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Generated certificate PDF files in storage are <strong>NOT</strong> deleted.</li>
              <li>Participant and batch records are <strong>NOT</strong> deleted.</li>
              <li>You can republish this batch at any time.</li>
            </ul>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
          >
            {errorMessage}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            data-testid="cancel-unpublish-button"
            disabled={isPending}
            onClick={() => {
              setErrorMessage(null);
              onClose();
            }}
            className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-unpublish-button"
            disabled={isPending}
            onClick={handleConfirm}
            className="inline-flex min-h-[38px] items-center justify-center rounded-md bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-2 text-xs font-semibold shadow-xs focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isPending ? "Unpublishing..." : "Confirm Unpublish"}
          </button>
        </div>
      </div>
    </div>
  );
}
