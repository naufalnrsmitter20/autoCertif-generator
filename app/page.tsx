import { Suspense } from "react";
import { searchPublishedCertificates } from "@/lib/search/service";
import { SearchForm } from "./search-form";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search Certificates — AutoCertif",
  description: "Search and verify published certificates by participant name.",
};

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawQ = params.q;
  const query = typeof rawQ === "string" ? rawQ.trim() : "";

  const searchResult = query.length > 0 ? await searchPublishedCertificates(query) : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Top Header */}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-6 w-1.5 rounded-full bg-telkom-red" aria-hidden="true" />
            <span className="text-lg font-bold tracking-tight text-charcoal dark:text-zinc-50">
              AutoCertif
            </span>
          </div>
          <span className="text-xs text-neutral-gray dark:text-zinc-400">
            Certificate Search
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="space-y-8">
          {/* Title and Intro */}
          <div className="text-center space-y-2">
            <h1
              data-testid="public-search-title"
              className="text-2xl font-bold tracking-tight text-charcoal sm:text-3xl dark:text-zinc-50"
            >
              Search Your Certificate
            </h1>
            <p className="text-sm text-neutral-gray dark:text-zinc-400">
              Find published certificates by entering your participant name.
            </p>
          </div>

          {/* Search Bar Container */}
          <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <Suspense fallback={<div className="h-10 animate-pulse bg-zinc-100 rounded dark:bg-zinc-800" />}>
              <SearchForm key={query} initialQuery={query} />
            </Suspense>
          </div>

          {/* Search Result States */}
          <section aria-label="Search results" className="space-y-4">
            {/* 1. INITIAL STATE: No search initiated */}
            {!searchResult && (
              <div
                data-testid="search-initial-state"
                className="rounded-lg border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800"
              >
                <p className="text-sm text-neutral-gray dark:text-zinc-400">
                  Search for your certificate by participant name.
                </p>
              </div>
            )}

            {/* 2. EMPTY QUERY: Whitespace query submitted */}
            {searchResult?.status === "empty_query" && (
              <div
                data-testid="search-empty-state"
                className="rounded-lg border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800"
              >
                <p className="text-sm text-neutral-gray dark:text-zinc-400">
                  Please enter a participant name to search.
                </p>
              </div>
            )}

            {/* 3. INVALID / OVERSIZED INPUT STATE */}
            {searchResult?.status === "invalid_length" && (
              <div
                role="alert"
                data-testid="search-invalid-length"
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
              >
                {searchResult.message}
              </div>
            )}

            {/* 4. SUCCESS: RESULTS OR NO RESULTS */}
            {searchResult?.status === "success" && (
              <>
                {searchResult.results.length === 0 ? (
                  /* NO RESULTS STATE */
                  <div
                    data-testid="no-results-message"
                    className="rounded-lg border border-zinc-200 bg-white p-8 text-center space-y-2 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <p className="text-sm font-medium text-charcoal dark:text-zinc-200">
                      No published certificate found for &ldquo;{searchResult.query}&rdquo;.
                    </p>
                    <p className="text-xs text-neutral-gray dark:text-zinc-400">
                      Please check the spelling of your name or verify that your certificate batch has been published.
                    </p>
                  </div>
                ) : (
                  /* RESULTS STATE */
                  <div className="space-y-3">
                    <p
                      data-testid="search-results-summary"
                      className="text-xs font-medium text-neutral-gray dark:text-zinc-400"
                    >
                      Found {searchResult.results.length} certificate{searchResult.results.length === 1 ? "" : "s"} for &ldquo;{searchResult.query}&rdquo;
                    </p>

                    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white shadow-xs dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                      {searchResult.results.map((c) => (
                        <li
                          key={c.certificateId}
                          data-testid={`search-result-item-${c.certificateId}`}
                          className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        >
                          <div className="space-y-0.5">
                            <span
                              data-testid="published-name"
                              className="text-sm font-medium text-charcoal dark:text-zinc-100"
                            >
                              {c.publishedName}
                            </span>
                            <p className="text-xs text-neutral-gray dark:text-zinc-400">
                              Certificate Available
                            </p>
                          </div>

                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                            Published
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
