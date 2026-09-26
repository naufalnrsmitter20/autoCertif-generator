import Link from "next/link";
import { CreateBatchForm } from "./create-batch-form";

export const metadata = {
  title: "Create Batch | AutoCertif Admin",
};

export default function NewBatchPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/admin/batches"
          className="inline-flex items-center text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 mb-2 focus:outline-none focus:ring-2 focus:ring-zinc-900 rounded px-1"
        >
          &larr; Back to Batches
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Create Certificate Batch
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Create a new batch for bulk certificate generation.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <CreateBatchForm />
      </div>
    </div>
  );
}
