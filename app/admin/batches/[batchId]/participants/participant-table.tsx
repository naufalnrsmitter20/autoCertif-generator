"use client";

import { useState, useEffect, useActionState } from "react";
import { editParticipantAction, deleteParticipantAction, type ParticipantActionState } from "./actions";

export interface ParticipantRow {
  id: string;
  name: string;
  createdAt: Date | string;
}

interface ParticipantTableProps {
  batchId: string;
  participants: ParticipantRow[];
  onMutationSuccess: () => void;
}

const initialEditState: ParticipantActionState = {};

// ─── Inline Edit Form ─────────────────────────────────────────────────────────

function EditParticipantInline({
  batchId,
  participant,
  onDone,
}: {
  batchId: string;
  participant: ParticipantRow;
  onDone: (success: boolean) => void;
}) {
  const boundAction = editParticipantAction.bind(null, batchId, participant.id);
  const [state, formAction, isPending] = useActionState(boundAction, initialEditState);

  useEffect(() => {
    if (state.success) {
      onDone(true);
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap">
      <input
        name="name"
        type="text"
        defaultValue={participant.name}
        required
        data-testid={`edit-name-input-${participant.id}`}
        aria-label={`Edit name for ${participant.name}`}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-charcoal focus:border-telkom-red focus:outline-none focus:ring-2 focus:ring-telkom-red/30 min-w-[180px]"
      />
      <button
        type="submit"
        disabled={isPending}
        data-testid={`save-edit-button-${participant.id}`}
        className="rounded-md bg-telkom-red px-2.5 py-1 text-xs font-semibold text-white hover:bg-telkom-red-dark disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-telkom-red"
      >
        {isPending ? "Saving..." : "Save"}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => onDone(false)}
        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-zinc-900"
      >
        Cancel
      </button>
      {state.error && !state.success && (
        <p role="alert" className="text-xs text-red-600 w-full">
          {state.error}
        </p>
      )}
    </form>
  );
}

// ─── Delete Confirmation ──────────────────────────────────────────────────────

function DeleteParticipantButton({
  batchId,
  participant,
  onSuccess,
}: {
  batchId: string;
  participant: ParticipantRow;
  onSuccess: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsPending(true);
    setError(null);
    try {
      const result = await deleteParticipantAction(batchId, participant.id);
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error ?? "Failed to delete participant.");
        setConfirming(false);
      }
    } finally {
      setIsPending(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        data-testid={`delete-button-${participant.id}`}
        className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600"
        aria-label={`Delete ${participant.name}`}
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={handleDelete}
          data-testid={`confirm-delete-button-${participant.id}`}
          className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          {isPending ? "Deleting..." : "Confirm Delete"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => { setConfirming(false); setError(null); }}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-zinc-900"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Main Table ───────────────────────────────────────────────────────────────

export function ParticipantTable({
  batchId,
  participants,
  onMutationSuccess,
}: ParticipantTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (participants.length === 0) {
    return (
      <p
        data-testid="participants-empty"
        className="text-sm text-neutral-gray py-4"
      >
        No participants yet. Import from CSV or add manually above.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200" data-testid="participants-table">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-gray"
            >
              Participant Name
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-gray"
            >
              Added
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-neutral-gray"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white">
          {participants.map((participant) => (
            <tr
              key={participant.id}
              data-testid={`participant-row-${participant.id}`}
            >
              <td className="px-4 py-3">
                {editingId === participant.id ? (
                  <EditParticipantInline
                    batchId={batchId}
                    participant={participant}
                    onDone={(success) => {
                      setEditingId(null);
                      if (success) onMutationSuccess();
                    }}
                  />
                ) : (
                  <span
                    data-testid={`participant-name-${participant.id}`}
                    className="font-medium text-charcoal"
                  >
                    {participant.name}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-neutral-gray whitespace-nowrap">
                {new Date(participant.createdAt).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </td>
              <td className="px-4 py-3 text-right">
                {editingId === participant.id ? null : (
                  <div className="flex items-center justify-end gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setEditingId(participant.id)}
                      data-testid={`edit-button-${participant.id}`}
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      aria-label={`Edit ${participant.name}`}
                    >
                      Edit
                    </button>
                    <DeleteParticipantButton
                      batchId={batchId}
                      participant={participant}
                      onSuccess={onMutationSuccess}
                    />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
