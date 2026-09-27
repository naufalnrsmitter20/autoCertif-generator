/**
 * Query sanitization and PostgreSQL LIKE pattern escaping for public search.
 */

/**
 * Generous technical request-size upper bound to protect against memory exhaustion attacks.
 * This is a technical transport boundary, NOT a business domain restriction.
 */
export const TECHNICAL_MAX_SEARCH_QUERY_LENGTH = 1000;

/**
 * Normalizes user search input:
 * - Rejects non-string inputs (returns null)
 * - Trims leading and trailing whitespace
 * - Returns null for empty or whitespace-only strings
 */
export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Escapes characters that PostgreSQL interprets as wildcards in LIKE / ILIKE queries:
 * - `\` -> `\\` (escape character)
 * - `%` -> `\%` (matches any sequence of zero or more characters)
 * - `_` -> `\_` (matches any single character)
 *
 * This ensures Prisma's `contains: escapedQuery, mode: "insensitive"` performs
 * strict literal substring matching without raw SQL interpolation.
 */
export function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
