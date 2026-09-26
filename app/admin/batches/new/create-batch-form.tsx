"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createBatchAction, type ActionState } from "../actions";

const initialState: ActionState = {};

export function CreateBatchForm() {
  const [state, formAction, isPending] = useActionState(
    createBatchAction,
    initialState
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && !state.fieldErrors?.name && (
        <div
          data-testid="create-batch-error"
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
        >
          {state.error}
        </div>
      )}

      <div>
        <label
          htmlFor="batch-name"
          className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          Batch Name <span className="text-rose-500">*</span>
        </label>
        <div className="mt-1.5">
          <input
            id="batch-name"
            name="name"
            type="text"
            required
            maxLength={150}
            disabled={isPending}
            placeholder="e.g. Web Development Bootcamp 2026"
            aria-describedby={
              state.fieldErrors?.name ? "batch-name-error" : undefined
            }
            aria-invalid={!!state.fieldErrors?.name}
            className="block w-full min-h-[44px] rounded-md border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
          />
        </div>
        {state.fieldErrors?.name && (
          <p
            id="batch-name-error"
            data-testid="batch-name-error"
            role="alert"
            className="mt-1.5 text-xs text-rose-600 dark:text-rose-400"
          >
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Link
          href="/admin/batches"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          data-testid="submit-create-batch"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-100"
        >
          {isPending ? "Creating..." : "Create Batch"}
        </button>
      </div>
    </form>
  );
}
