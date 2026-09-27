"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface SearchFormProps {
  initialQuery?: string;
}

export function SearchForm({ initialQuery = "" }: SearchFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      router.push("/");
    } else {
      router.push(`/?q=${encodeURIComponent(trimmed)}`);
    }
  }

  function handleClear() {
    setQuery("");
    inputRef.current?.focus();
    router.push("/");
  }

  return (
    <form
      onSubmit={handleSubmit}
      method="GET"
      action="/"
      role="search"
      className="w-full space-y-3"
    >
      <div>
        <label
          htmlFor="certificate-search"
          className="block text-sm font-medium text-charcoal mb-1.5"
        >
          Participant Name
        </label>
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            id="certificate-search"
            name="q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Naufal Nabil Ramadhan"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            data-testid="public-search-input"
            className="w-full rounded-md border border-zinc-300 bg-white px-4 py-2.5 pr-20 text-sm text-charcoal placeholder-neutral-gray transition-colors focus:border-telkom-red focus:outline-none focus:ring-1 focus:ring-telkom-red dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />

          <div className="absolute right-1.5 flex items-center gap-1">
            {query.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search input"
                data-testid="clear-search-button"
                className="rounded px-2 py-1 text-xs text-neutral-gray hover:text-charcoal focus:outline-none dark:hover:text-zinc-200"
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              data-testid="public-search-submit"
              className="rounded-md bg-telkom-red px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-telkom-red-dark focus:outline-none focus:ring-2 focus:ring-telkom-red focus:ring-offset-2"
            >
              Search
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
