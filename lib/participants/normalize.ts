/**
 * Canonical participant name normalization.
 *
 * Rules (applied in order):
 *  1. Input must be string; non-string returns null.
 *  2. Trim leading/trailing whitespace.
 *  3. Collapse consecutive internal whitespace to a single ordinary space.
 *  4. Preserve actual characters, accents, punctuation, and capitalization.
 *  5. Empty result after normalization → null (invalid).
 */
export function normalizeParticipantName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  const collapsed = trimmed.replace(/\s+/g, " ");

  if (collapsed.length === 0) return null;

  return collapsed;
}

/**
 * Canonical duplicate-comparison key.
 * Derived from the normalized name by lowercasing.
 * The stored display value is never lowercased.
 */
export function duplicateKey(normalizedName: string): string {
  return normalizedName.toLowerCase();
}
