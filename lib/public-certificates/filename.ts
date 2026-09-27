/**
 * Sanitizes a published participant name into a safe, human-friendly download filename.
 *
 * Rules:
 * - Lowercase alphanumeric characters and single hyphens.
 * - Accents/diacritics stripped via NFD decomposition and character transliteration.
 * - Non-alphanumeric characters replaced with hyphens.
 * - Leading/trailing hyphens removed.
 * - Maximum slug length bounded to 60 characters to prevent filesystem/header issues.
 * - Safe fallback: 'certificate.pdf' if sanitized slug is empty.
 * - Strict extension: always ends with '.pdf'.
 * - Free of directory traversal (no '.', '/', '\').
 */
export function sanitizeDownloadFilename(publishedName: string | null | undefined): string {
  if (!publishedName || typeof publishedName !== "string") {
    return "certificate.pdf";
  }

  const slug = publishedName
    .replace(/[\u0141\u0142]/g, "l") // Ł, ł
    .replace(/[\u00D8\u00F8]/g, "o") // Ø, ø
    .replace(/[\u00C6\u00E6]/g, "ae") // Æ, æ
    .replace(/[\u00DF]/g, "ss") // ß
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // replace symbols and whitespace with hyphens
    .replace(/^-+|-+$/g, "") // trim leading and trailing hyphens
    .slice(0, 60)
    .replace(/-+$/, ""); // re-trim after truncation

  if (!slug) {
    return "certificate.pdf";
  }

  return `certificate-${slug}.pdf`;
}
