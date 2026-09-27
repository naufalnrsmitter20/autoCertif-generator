import { NextRequest, NextResponse } from "next/server";
import {
  getPublishedCertificateById,
  verifyPublishedCertificateSnapshot,
  sanitizeDownloadFilename,
} from "@/lib/public-certificates";
import { createCertificateSignedReadUrl } from "@/lib/storage/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ certificateId: string }>;
}

/**
 * Public Certificate Download Route Handler.
 *
 * Flow:
 * 1. Resolves certificateId from route params.
 * 2. Step 1: Evaluates real-time public eligibility via getPublishedCertificateById.
 *    If missing/unpublished -> returns explicit HTTP 404 with Cache-Control: no-store.
 * 3. Step 2: Derives human-friendly sanitized filename from publishedName and creates short-lived signed URL.
 * 4. Step 3: Lightweight final snapshot/eligibility recheck.
 *    If batch was unpublished or snapshot changed during signing -> discards token and returns HTTP 404.
 * 5. Step 4: Redirects browser (HTTP 302) to signed storage URL with Cache-Control: no-store.
 *
 * Guarantees:
 * - Publicly accessible without authentication.
 * - Zero PDF bytes proxied through Vercel Functions.
 * - Private storage paths and service credentials never leaked as application data.
 * - No caching of publication state or redirects.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { certificateId } = await context.params;

  // Step 1: Initial real-time public eligibility check
  const cert = await getPublishedCertificateById(certificateId);
  if (!cert) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  // Step 2: Create short-lived signed URL with download filename
  const filename = sanitizeDownloadFilename(cert.publishedName);
  let downloadUrl: string;

  try {
    downloadUrl = await createCertificateSignedReadUrl(
      cert.publishedFilePath,
      300,
      filename
    );
  } catch {
    // Infrastructure / Storage failure: return 503 without leaking details
    return new NextResponse(null, {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  // Step 3: Final lightweight snapshot/eligibility recheck immediately after signing
  const isStillValid = await verifyPublishedCertificateSnapshot(
    cert.id,
    cert.publishedFilePath
  );

  if (!isStillValid) {
    // The certificate was unpublished or snapshot changed during signing.
    // Discard the signed URL and return 404 with no-store.
    return new NextResponse(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  // Step 4: Safe redirect to Supabase Storage signed download URL
  return NextResponse.redirect(downloadUrl, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
