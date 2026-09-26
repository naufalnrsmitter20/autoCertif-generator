import Link from "next/link";

export default function BatchNotFound() {
  return (
    <div
      data-testid="batch-not-found"
      className="max-w-md mx-auto my-12 rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-xs dark:border-zinc-800 dark:bg-zinc-900 space-y-4"
    >
      <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        Batch Not Found
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This certificate batch does not exist or has been deleted.
      </p>
      <div>
        <Link
          href="/admin/batches"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-100"
        >
          Return to Batches
        </Link>
      </div>
    </div>
  );
}
