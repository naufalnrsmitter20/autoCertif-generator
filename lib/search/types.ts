/**
 * Public Certificate Search Types (Phase 12)
 *
 * Strict contract:
 * - Exposes ONLY public-safe fields: certificateId and publishedName.
 * - NEVER exposes publishedFilePath, participantId, batchId, generation keys, or storage paths.
 */

export type PublicCertificateSearchResult = {
  certificateId: string;
  publishedName: string;
};

export type SearchQueryResult =
  | { status: "invalid_length"; message: string }
  | { status: "success"; query: string; results: PublicCertificateSearchResult[] };
