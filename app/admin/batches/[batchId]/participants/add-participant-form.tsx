"use client";

import { useEffect, useRef, useActionState } from "react";
import { addParticipantAction, type ParticipantActionState } from "./actions";

interface AddParticipantFormProps {
  batchId: string;
  onSuccess: () => void;
}

const initialState: ParticipantActionState = {};

export function AddParticipantForm({
  batchId,
  onSuccess,
}: AddParticipantFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const boundAction = addParticipantAction.bind(null, batchId);
  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState
  );

  useEffect(() => {
    if (state.success) {
      onSuccess();
      formRef.current?.reset();
    }
  }, [state.success, onSuccess]);

  return (
    <form
      ref={formRef}
      action={formAction}
      data-testid="add-participant-form"
      className="space-y-3"
    >
      <div>
        <label
          htmlFor="add-participant-name"
          className="block text-sm font-medium text-charcoal"
        >
          Participant Name
        </label>
        <input
          id="add-participant-name"
          name="name"
          type="text"
          required
          autoComplete="off"
          data-testid="add-participant-name-input"
          placeholder="e.g. Naufal Nabil Ramadhan"
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-charcoal placeholder-zinc-400 shadow-xs focus:border-telkom-red focus:outline-none focus:ring-2 focus:ring-telkom-red/30"
        />
        {state.fieldErrors?.name && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>

      {state.error && !state.success && (
        <p
          role="alert"
          data-testid="add-participant-error"
          className="text-xs text-red-600"
        >
          {state.error}
        </p>
      )}

      {state.success && (
        <p
          role="status"
          data-testid="add-participant-success"
          className="text-xs text-emerald-700"
        >
          Participant added.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        data-testid="submit-add-participant"
        className="inline-flex items-center justify-center rounded-md bg-telkom-red px-4 py-2 text-sm font-semibold text-white hover:bg-telkom-red-dark focus:outline-none focus:ring-2 focus:ring-telkom-red disabled:opacity-50 transition-colors"
      >
        {isPending ? "Adding..." : "Add Participant"}
      </button>
    </form>
  );
}
