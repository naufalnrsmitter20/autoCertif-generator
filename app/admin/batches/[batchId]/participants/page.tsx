import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveBatchById } from "@/lib/batches";
import { getActiveParticipants } from "@/lib/participants/service";
import { BatchStatusBadge } from "@/components/batch-status-badge";
import { ParticipantsClient } from "./participants-client";

export const metadata = {
  title: "Manage Participants | AutoCertif Admin",
};

interface ParticipantsPageProps {
  params: Promise<{ batchId: string }>;
}

export default async function ParticipantsPage({
  params,
}: ParticipantsPageProps) {
  const { batchId } = await params;

  const [batch, participants] = await Promise.all([
    getActiveBatchById(batchId),
    getActiveParticipants(batchId).catch(() => []),
  ]);

  if (!batch) {
    notFound();
  }

  const isDraft = batch.status === "DRAFT";

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div>
        <nav aria-label="Breadcrumb" className="text-sm mb-3">
          <ol className="flex items-center gap-1 text-neutral-gray">
            <li>
              <Link
                href="/admin/batches"
                className="hover:text-charcoal focus:outline-none focus:ring-2 focus:ring-telkom-red rounded px-0.5"
              >
                Batches
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                href={`/admin/batches/${batchId}`}
                className="hover:text-charcoal focus:outline-none focus:ring-2 focus:ring-telkom-red rounded px-0.5"
              >
                {batch.name}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-charcoal font-medium">Participants</li>
          </ol>
        </nav>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-charcoal">
            Manage Participants
          </h1>
          <BatchStatusBadge status={batch.status} />
        </div>
        <p className="mt-1 text-sm text-neutral-gray">
          Batch:{" "}
          <span className="font-medium text-charcoal">{batch.name}</span>
        </p>
      </div>

      {/* Non-DRAFT warning */}
      {!isDraft && (
        <div
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
        >
          <strong>Read-only view.</strong> Participant import and CRUD are only
          available while the batch is in <strong>DRAFT</strong> status.
          Current status: <strong>{batch.status}</strong>.
        </div>
      )}

      {isDraft ? (
        <ParticipantsClient
          batchId={batchId}
          initialParticipants={participants.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: p.createdAt,
          }))}
        />
      ) : (
        /* Read-only list for non-DRAFT batches */
        <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs">
          <h2 className="text-base font-semibold text-charcoal mb-4">
            Active Participants ({participants.length})
          </h2>
          {participants.length === 0 ? (
            <p className="text-sm text-neutral-gray">No participants.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {participants.map((p) => (
                <li key={p.id} className="py-2 text-sm text-charcoal">
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
