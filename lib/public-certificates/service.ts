import { prisma } from "@/lib/prisma";
import type { PublicCertificateSnapshot } from "./types";

/**
 * Retries transient database network/DNS errors (e.g. EAI_AGAIN on Supabase connection pooler).
 */
async function withPrismaRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (i === retries - 1) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code;
      if (
        code === "EAI_AGAIN" ||
        msg.includes("EAI_AGAIN") ||
        msg.includes("timeout") ||
        msg.includes("ECONNRESET") ||
        msg.includes("fetch failed") ||
        msg.includes("Can't reach database server")
      ) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Prisma query retry exhausted");
}

/**
 * Pure domain query to fetch an authoritative published certificate snapshot by ID.
 *
 * Requirements & Invariants:
 * - Publicly accessible without authentication.
 * - Authoritative visibility gate:
 *   - certificate.id == requested certificateId
 *   - certificate.deletedAt == null
 *   - certificate.publishedName != null
 *   - certificate.publishedFilePath != null
 *   - participant.deletedAt == null
 *   - batch.deletedAt == null
 *   - batch.publishedAt != null
 * - Decoupled from operational batch/certificate lifecycle:
 *   - Does NOT require batch.status == PUBLISHED (supports published replacements in GENERATING or FAILED states)
 *   - Does NOT require Certificate.status == GENERATED or isStale == false
 *   - Does NOT require Certificate.generationKey == batch.currentGenerationKey
 * - Published snapshot fields (publishedName, publishedFilePath) are authoritative.
 * - Server-only: publishedFilePath is used for storage signing, never leaked as application data.
 */
export async function getPublishedCertificateById(
  certificateId: unknown
): Promise<PublicCertificateSnapshot | null> {
  if (!certificateId || typeof certificateId !== "string" || certificateId.trim() === "") {
    return null;
  }

  const normalizedId = certificateId.trim();

  const cert = await withPrismaRetry(() =>
    prisma.certificate.findFirst({
      where: {
        id: normalizedId,
        deletedAt: null,
        publishedName: {
          not: null,
        },
        publishedFilePath: {
          not: null,
        },
        participant: {
          deletedAt: null,
        },
        batch: {
          deletedAt: null,
          publishedAt: {
            not: null,
          },
        },
      },
      select: {
        id: true,
        publishedName: true,
        publishedFilePath: true,
      },
    })
  );

  if (!cert || !cert.publishedName || !cert.publishedFilePath) {
    return null;
  }

  return {
    id: cert.id,
    publishedName: cert.publishedName,
    publishedFilePath: cert.publishedFilePath,
  };
}

/**
 * Lightweight final eligibility and snapshot recheck performed immediately after signing.
 *
 * Guarantees that:
 * 1. The batch has not been unpublished during the storage signing call (batch.publishedAt != null).
 * 2. Neither the certificate, participant, nor batch has been soft-deleted.
 * 3. The publishedFilePath has not changed during signing (detects concurrent snapshot replacement).
 *
 * If this recheck fails, the newly signed URL MUST NOT be returned to the browser.
 */
export async function verifyPublishedCertificateSnapshot(
  certificateId: string,
  expectedFilePath: string
): Promise<boolean> {
  if (!certificateId || !expectedFilePath) {
    return false;
  }

  const cert = await withPrismaRetry(() =>
    prisma.certificate.findFirst({
      where: {
        id: certificateId,
        deletedAt: null,
        publishedFilePath: expectedFilePath,
        publishedName: {
          not: null,
        },
        participant: {
          deletedAt: null,
        },
        batch: {
          deletedAt: null,
          publishedAt: {
            not: null,
          },
        },
      },
      select: {
        id: true,
      },
    })
  );

  return cert !== null;
}
