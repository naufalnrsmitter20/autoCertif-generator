"use client";

import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CertificateError({ reset }: ErrorProps) {
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
          data-testid="certificate-error-boundary"
          className="rounded-lg border border-zinc-200 bg-white p-8 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 space-y-4"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
            <svg
              className="h-6 w-6 text-telkom-red"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-charcoal dark:text-zinc-50">
            Temporary Service Error
          </h1>

          <p className="text-sm text-neutral-gray dark:text-zinc-400">
            The certificate service encountered a temporary issue. Please try again.
          </p>

          <div className="pt-2 flex justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-telkom-red px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-telkom-red-dark focus:outline-none focus:ring-2 focus:ring-telkom-red focus:ring-offset-2"
            >
              Try Again
            </button>
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-charcoal shadow-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              Back to Search
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
