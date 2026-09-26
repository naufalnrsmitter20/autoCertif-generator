"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { CsvImportSection } from "./csv-import-section";
import { AddParticipantForm } from "./add-participant-form";
import { ParticipantTable, type ParticipantRow } from "./participant-table";

interface ParticipantsClientProps {
  batchId: string;
  initialParticipants: ParticipantRow[];
}

export function ParticipantsClient({
  batchId,
  initialParticipants,
}: ParticipantsClientProps) {
  const router = useRouter();
  // After each mutation, trigger a router refresh to re-fetch server data
  const handleMutation = useCallback(() => {
    router.refresh();
  }, [router]);

  const existingNames = initialParticipants.map((p) => p.name);

  return (
    <div className="space-y-8">
      {/* CSV Import Section */}
      <section
        aria-labelledby="csv-import-heading"
        className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs"
      >
        <h2
          id="csv-import-heading"
          className="text-base font-semibold text-charcoal"
        >
          Import from CSV
        </h2>
        <p className="mt-1 text-sm text-neutral-gray">
          Select a CSV file with a <code className="font-mono text-xs">name</code> column.
          Preview and confirm before participants are saved.
        </p>
        <div className="mt-4">
          <CsvImportSection
            batchId={batchId}
            existingNames={existingNames}
            onImportSuccess={handleMutation}
          />
        </div>
      </section>

      {/* Manual Add Section */}
      <section
        aria-labelledby="add-participant-heading"
        className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs"
      >
        <h2
          id="add-participant-heading"
          className="text-base font-semibold text-charcoal"
        >
          Add Participant Manually
        </h2>
        <p className="mt-1 text-sm text-neutral-gray">
          Add a single participant by name.
        </p>
        <div className="mt-4 max-w-sm">
          <AddParticipantForm batchId={batchId} onSuccess={handleMutation} />
        </div>
      </section>

      {/* Participant List */}
      <section
        aria-labelledby="participants-list-heading"
        className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              id="participants-list-heading"
              className="text-base font-semibold text-charcoal"
            >
              Active Participants
            </h2>
            <p className="text-sm text-neutral-gray">
              {initialParticipants.length} participant
              {initialParticipants.length !== 1 ? "s" : ""} in this batch.
            </p>
          </div>
        </div>
        <ParticipantTable
          batchId={batchId}
          participants={initialParticipants}
          onMutationSuccess={handleMutation}
        />
      </section>
    </div>
  );
}
