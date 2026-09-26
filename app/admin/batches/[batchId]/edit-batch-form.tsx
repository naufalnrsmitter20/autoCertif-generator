"use client";

import { useActionState } from "react";
import { updateBatchNameAction, type ActionState } from "../actions";

interface EditBatchFormProps {
  batchId: string;
  initialName: string;
}

export function EditBatchForm({ batchId, initialName }: EditBatchFormProps) {
  const updateActionWithId = updateBatchNameAction.bind(null, batchId);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    updateActionWithId,
    {}
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.success && (
        <div
          data-testid="edit-batch-success"
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          Batch name updated successfully.
        </div>
      )}

      {state.error && !state.fieldErrors?.name && (
        <div
          data-testid="edit-batch-error"
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
        >
          {state.error}
        </div>
      )}

      <div>
        <label
          htmlFor="edit-batch-name"
          className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          Batch Name <span className="text-rose-500">*</span>
        </label>
        <div className="mt-1.5">
          <input
            id="edit-batch-name"
            name="name"
            type="text"
            required
            maxLength={150}
            disabled={isPending}
            key={initialName}
            defaultValue={initialName}
            aria-describedby={
              state.fieldErrors?.name ? "edit-batch-name-error" : undefined
            }
            aria-invalid={!!state.fieldErrors?.name}
            className="block w-full max-w-lg min-h-[44px] rounded-md border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
          />
        </div>
        {state.fieldErrors?.name && (
          <p
            id="edit-batch-name-error"
            data-testid="edit-batch-name-error"
            role="alert"
            className="mt-1.5 text-xs text-rose-600 dark:text-rose-400"
          >
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          data-testid="submit-edit-batch"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-100"
        >
          {isPending ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
