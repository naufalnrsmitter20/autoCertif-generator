import { BatchStatus } from "@/generated/prisma/client";

const statusConfig: Record<
  BatchStatus,
  { label: string; className: string }
> = {
  [BatchStatus.DRAFT]: {
    label: "Draft",
    className:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  },
  [BatchStatus.READY]: {
    label: "Ready",
    className:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800",
  },
  [BatchStatus.GENERATING]: {
    label: "Generating",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
  [BatchStatus.GENERATED]: {
    label: "Generated",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  },
  [BatchStatus.PUBLISHED]: {
    label: "Published",
    className:
      "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800",
  },
  [BatchStatus.FAILED]: {
    label: "Failed",
    className:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800",
  },
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const config = statusConfig[status] ?? {
    label: status,
    className:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  };

  return (
    <span
      data-testid="batch-status-badge"
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
