/**
 * Public Certificate Types (Phase 13)
 *
 * Strict contract:
 * - Publicly visible client snapshot exposes ONLY public-safe fields: certificateId and publishedName.
 * - publishedFilePath is an internal server-only field used strictly for storage signing.
 * - Bare object paths are never exposed as application data.
 * - NEVER exposes participantId, batchId, generation keys, or soft deletion flags.
 */

export interface PublicCertificateSnapshot {
  id: string;
  publishedName: string;
  publishedFilePath: string;
}

export interface PublicCertificateDetail {
  certificateId: string;
  publishedName: string;
  previewUrl: string;
}
