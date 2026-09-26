export default function BatchesLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="h-7 w-48 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
          <div className="mt-2 h-4 w-64 rounded bg-zinc-100 dark:bg-zinc-800/60 animate-pulse" />
        </div>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-4">
          <div className="h-6 w-full rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          <div className="h-6 w-full rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          <div className="h-6 w-full rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
