import { CertificateStatus } from "@/generated/prisma/enums";

type DisplayStatus = CertificateStatus | "UNINITIALIZED";

const statusConfig: Record<
  DisplayStatus,
  { label: string; className: string }
> = {
  [CertificateStatus.PENDING]: {
    label: "Pending",
    className:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  },
  [CertificateStatus.GENERATING]: {
    label: "Generating",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
  [CertificateStatus.GENERATED]: {
    label: "Generated",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  },
  [CertificateStatus.FAILED]: {
    label: "Failed",
    className:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800",
  },
  UNINITIALIZED: {
    label: "Not Started",
    className:
      "bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
  },
};

export function CertificateStatusBadge({ status }: { status: DisplayStatus }) {
  const config = statusConfig[status] ?? {
    label: status,
    className:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  };

  return (
    <span
      data-testid="certificate-status-badge"
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
