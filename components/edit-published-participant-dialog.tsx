"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface EditPublishedParticipantDialogProps {
  batchId: string;
  participantId: string;
  currentName: string;
  publishedName: string | null;
  expectedCurrentGenerationKey: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function EditPublishedParticipantDialog({
  batchId,
  participantId,
  currentName,
  publishedName,
  expectedCurrentGenerationKey,
  isOpen,
  onClose,
  onSuccess,
}: EditPublishedParticipantDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [nameInput, setNameInput] = useState(currentName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmed = nameInput.trim();
    if (!trimmed) {
      setErrorMessage("Participant name cannot be empty.");
      return;
    }

    if (trimmed === currentName.trim()) {
      setErrorMessage("New name must be different from the current name.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/batches/${batchId}/generation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "edit-published-participant",
            participantId,
            newName: trimmed,
            expectedCurrentGenerationKey,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          setErrorMessage(data.error || "Failed to update participant name.");
        } else {
          onClose();
          if (onSuccess) onSuccess();
          router.refresh();
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to update participant name."
        );
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-published-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h3
          id="edit-published-dialog-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
        >
          Edit Published Participant Name
        </h3>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1 text-xs">
            <label
              htmlFor="edit-participant-name-input"
              className="font-medium text-zinc-700 dark:text-zinc-300"
            >
              Participant Name
            </label>
            <input
              id="edit-participant-name-input"
              data-testid="edit-published-name-input"
              type="text"
              value={nameInput}
              disabled={isPending}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-telkom-red dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/50 text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">
              Safe replacement behavior:
            </p>
            <p>
              The current published certificate for{" "}
              <strong>&quot;{publishedName || currentName}&quot;</strong> will remain
              publicly live and searchable while the replacement certificate generates in the
              background.
            </p>
            <p>
              The public snapshot will atomically cut over to the new name and PDF only
              after successful rendering.
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
            >
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              data-testid="cancel-edit-published-name-button"
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
              type="submit"
              data-testid="confirm-edit-published-name-button"
              disabled={isPending}
              className="inline-flex min-h-[38px] items-center justify-center rounded-md bg-telkom-red hover:bg-telkom-red-dark px-4 py-2 text-xs font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-telkom-red transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isPending ? "Starting Update..." : "Update & Regenerate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
