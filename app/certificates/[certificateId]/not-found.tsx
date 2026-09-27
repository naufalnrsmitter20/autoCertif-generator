import Link from "next/link";

export default function CertificateNotFound() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-6 w-1.5 rounded-full bg-telkom-red" aria-hidden="true" />
            <span className="text-lg font-bold tracking-tight text-charcoal dark:text-zinc-50">
              AutoCertif
            </span>
          </div>
          <Link
            href="/"
            className="text-sm font-medium text-neutral-gray hover:text-charcoal dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            &larr; Search
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
        <div
          data-testid="certificate-not-found"
          className="rounded-lg border border-zinc-200 bg-white p-8 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 space-y-4"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <svg
              className="h-6 w-6 text-neutral-gray dark:text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
              />
            </svg>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-charcoal dark:text-zinc-50">
            Certificate Not Found
          </h1>

          <p className="text-sm text-neutral-gray dark:text-zinc-400">
            This certificate does not exist, has been removed, or has not been published yet.
          </p>

          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-telkom-red px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-telkom-red-dark focus:outline-none focus:ring-2 focus:ring-telkom-red focus:ring-offset-2"
            >
              Back to Search
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
