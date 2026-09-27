import { prisma } from "@/lib/prisma";
import {
  normalizeSearchQuery,
  escapeLikePattern,
  TECHNICAL_MAX_SEARCH_QUERY_LENGTH,
} from "./normalize";
import type { SearchQueryResult } from "./types";

/**
 * Pure domain query to search published certificates by participant name.
 *
 * Requirements & Invariants:
 * - Publicly accessible without authentication.
 * - Searches Certificate.publishedName exclusively using case-insensitive substring matching.
 * - Authoritative visibility gate is batch.publishedAt != null (does NOT require batch.status == PUBLISHED).
 * - Does NOT require Certificate.status == GENERATED or isStale == false.
 * - Filters out soft-deleted records across batch, participant, and certificate.
 * - Filters out records where publishedName or publishedFilePath is null.
 * - Returns ALL matching public certificates (no hard truncation).
 * - Deterministic ordering: publishedName ASC, id ASC.
 * - Exposes only public-safe fields: certificateId and publishedName.
 */
export async function searchPublishedCertificates(
  rawQuery: unknown
): Promise<SearchQueryResult> {
  const normalized = normalizeSearchQuery(rawQuery);

  if (normalized === null) {
    return { status: "empty_query" };
  }

  if (normalized.length > TECHNICAL_MAX_SEARCH_QUERY_LENGTH) {
    return {
      status: "invalid_length",
      message: `Search query exceeds technical maximum length of ${TECHNICAL_MAX_SEARCH_QUERY_LENGTH} characters.`,
    };
  }

  const escaped = escapeLikePattern(normalized);

  const certificates = await prisma.certificate.findMany({
    where: {
      deletedAt: null,
      publishedName: {
        not: null,
        contains: escaped,
        mode: "insensitive",
      },
      publishedFilePath: {
        not: null,
      },
      participant: {
        deletedAt: null,
      },
      batch: {
        publishedAt: {
          not: null,
        },
        deletedAt: null,
      },
    },
    select: {
      id: true,
      publishedName: true,
    },
    orderBy: [
      { publishedName: "asc" },
      { id: "asc" },
    ],
  });

  return {
    status: "success",
    query: normalized,
    results: certificates.map((c) => ({
      certificateId: c.id,
      publishedName: c.publishedName!,
    })),
  };
}
