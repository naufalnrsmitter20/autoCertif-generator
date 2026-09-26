import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveBatchById, getBatchGenerationSummary } from "@/lib/batches";
import { BatchStatusBadge } from "@/components/batch-status-badge";
import { formatDisplayDate } from "@/lib/date";
import { EditBatchForm } from "./edit-batch-form";
import { DeleteBatchDialog } from "./delete-batch-dialog";
import { TemplateSection } from "./template-section";
import { GenerationSection } from "./generation-section";

export const metadata = {
  title: "Batch Details | AutoCertif Admin",
};

interface BatchDetailPageProps {
  params: Promise<{ batchId: string }>;
}

export default async function BatchDetailPage({
  params,
}: BatchDetailPageProps) {
  const { batchId } = await params;
  const batch = await getActiveBatchById(batchId);

  if (!batch) {
    notFound();
  }

  const summary = await getBatchGenerationSummary(batchId);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <Link
          href="/admin/batches"
          className="inline-flex items-center text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 mb-3 focus:outline-none focus:ring-2 focus:ring-zinc-900 rounded px-1"
        >
          &larr; Back to Batches
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1
            data-testid="batch-detail-title"
            className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            {batch.name}
          </h1>
          <div>
            <BatchStatusBadge status={batch.status} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Template Status
          </p>
          <p
            data-testid="batch-template-status"
            className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {batch.template ? batch.template.name : "Not configured"}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Created Date
          </p>
          <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {formatDisplayDate(batch.createdAt)}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Last Updated
          </p>
          <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {formatDisplayDate(batch.updatedAt)}
          </p>
        </div>
      </div>

      <TemplateSection
        key={batch.template?.id ?? "none"}
        batchId={batch.id}
        batchStatus={batch.status}
        initialTemplate={batch.template}
      />

      {/* Participants entry point */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Participants
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Import from CSV or manage individual participants for this batch.
        </p>
        <div className="mt-4">
          <Link
            href={`/admin/batches/${batch.id}/participants`}
            data-testid="manage-participants-link"
            className="inline-flex items-center justify-center rounded-md bg-telkom-red hover:bg-telkom-red-dark px-4 py-2 text-sm font-semibold text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-telkom-red transition-colors"
          >
            Manage Participants
          </Link>
        </div>
      </div>

      <GenerationSection
        batchId={batch.id}
        batchStatus={batch.status}
        hasTemplate={Boolean(batch.template)}
        hasPlacement={Boolean(batch.template?.namePlacement)}
        participantCount={batch._count?.participants ?? 0}
        summary={summary}
      />

      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Edit Batch Name
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Update the display name for this certificate batch.
        </p>
        <div className="mt-4">
          <EditBatchForm batchId={batch.id} initialName={batch.name} />
        </div>
      </div>

      <div className="rounded-lg border border-rose-200 bg-white p-6 shadow-xs dark:border-rose-950 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-rose-900 dark:text-rose-400">
          Danger Zone
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Soft-delete this certificate batch. It will be removed from the active batch list.
        </p>
        <div className="mt-4">
          <DeleteBatchDialog batchId={batch.id} batchName={batch.name} />
        </div>
      </div>
    </div>
  );
}
