"use client";

import { useState, useTransition } from "react";
import { deleteBatchAction } from "../actions";

interface DeleteBatchDialogProps {
  batchId: string;
  batchName: string;
}

export function DeleteBatchDialog({
  batchId,
  batchName,
}: DeleteBatchDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteBatchAction(batchId);
    });
  }

  return (
    <div>
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          data-testid="open-delete-dialog-button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:ring-offset-2 dark:border-rose-800 dark:bg-zinc-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
        >
          Delete Batch
        </button>
      ) : (
        <div
          data-testid="delete-confirmation-container"
          className="rounded-md border border-rose-300 bg-rose-50/50 p-4 dark:border-rose-900 dark:bg-rose-950/30 space-y-3 max-w-lg"
        >
          <p className="text-sm font-medium text-rose-900 dark:text-rose-300">
            Are you sure you want to delete <span className="font-bold">{batchName}</span>?
          </p>
          <p className="text-xs text-rose-700 dark:text-rose-400">
            This batch will be soft-deleted and removed from the active batches list.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              disabled={isPending}
              onClick={handleDelete}
              data-testid="confirm-delete-batch-button"
              className="inline-flex min-h-[40px] items-center justify-center rounded-md bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:ring-offset-2 disabled:opacity-50"
            >
              {isPending ? "Deleting..." : "Yes, delete batch"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsOpen(false)}
              data-testid="cancel-delete-batch-button"
              className="inline-flex min-h-[40px] items-center justify-center rounded-md border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
