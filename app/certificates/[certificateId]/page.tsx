import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  getPublishedCertificateById,
  verifyPublishedCertificateSnapshot,
} from "@/lib/public-certificates";
import { createCertificateSignedReadUrl } from "@/lib/storage/server";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ certificateId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { certificateId } = await params;
  const cert = await getPublishedCertificateById(certificateId);

  if (!cert) {
    return {
      title: "Certificate Not Found — AutoCertif",
      description: "The requested certificate is not available.",
    };
  }

  return {
    title: `Certificate — ${cert.publishedName} — AutoCertif`,
    description: `Published certificate for ${cert.publishedName}.`,
  };
}

export default async function CertificateDetailPage({ params }: PageProps) {
  const { certificateId } = await params;

  // Step 1: Initial public eligibility check
  const cert = await getPublishedCertificateById(certificateId);
  if (!cert) {
    notFound();
  }

  // Step 2: Create short-lived signed preview URL (5 minutes TTL)
  let signedPreviewUrl: string;
  try {
    signedPreviewUrl = await createCertificateSignedReadUrl(cert.publishedFilePath, 300);
  } catch {
    // Infrastructure / Storage operation failure: do NOT falsely report 404
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-medium text-neutral-gray hover:text-charcoal dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              &larr; Back to Search
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-xl px-4 py-16 sm:px-6 text-center">
          <div
            data-testid="storage-unavailable-state"
            className="rounded-lg border border-amber-200 bg-amber-50 p-8 shadow-xs dark:border-amber-900/50 dark:bg-amber-950/40"
          >
            <h1 className="text-lg font-bold text-amber-900 dark:text-amber-200">
              Certificate Preview Temporarily Unavailable
            </h1>
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
              The certificate for <span className="font-semibold">{cert.publishedName}</span> is published, but the storage service is currently experiencing a delay. Please refresh or try again in a few moments.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                href={`/certificates/${cert.id}`}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-800"
              >
                Retry
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-charcoal hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                Back to Search
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Step 3: Lightweight final snapshot/eligibility recheck immediately after signing
  const isStillValid = await verifyPublishedCertificateSnapshot(cert.id, cert.publishedFilePath);
  if (!isStillValid) {
    // Snapshot was unpublished or changed during signing; discard token and 404
    notFound();
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Top Header */}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-6 w-1.5 rounded-full bg-telkom-red" aria-hidden="true" />
            <span className="text-lg font-bold tracking-tight text-charcoal dark:text-zinc-50">
              AutoCertif
            </span>
          </div>

          <Link
            href="/"
            data-testid="back-to-search-link"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-neutral-gray transition-colors hover:text-charcoal focus:outline-none focus:ring-2 focus:ring-telkom-red focus:ring-offset-2 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            &larr; Back to Search
          </Link>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
        {/* Certificate Identity & Actions Bar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                Published Certificate
              </span>
            </div>
            <h1
              data-testid="certificate-participant-name"
              className="text-2xl font-bold tracking-tight text-charcoal sm:text-3xl dark:text-zinc-50"
            >
              {cert.publishedName}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Download Certificate Action */}
            <a
              href={`/certificates/${cert.id}/download`}
              data-testid="certificate-download-button"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-telkom-red px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-telkom-red-dark focus:outline-none focus:ring-2 focus:ring-telkom-red focus:ring-offset-2"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.5V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              Download Certificate
            </a>

            {/* Open in New Tab Fallback for Mobile / External Viewer */}
            <a
              href={signedPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="certificate-open-pdf-link"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-charcoal shadow-xs transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Open in New Tab
            </a>
          </div>
        </div>

        {/* Certificate Preview Frame (Dominant Element) */}
        <section aria-label="Certificate preview" className="space-y-2">
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <iframe
              src={signedPreviewUrl}
              title={`Certificate for ${cert.publishedName}`}
              referrerPolicy="no-referrer"
              data-testid="certificate-preview-iframe"
              className="h-[520px] w-full sm:h-[720px] lg:h-[800px] border-0"
            />
          </div>
          <p className="text-center text-xs text-neutral-gray dark:text-zinc-400">
            If the certificate preview does not load on your device, use the &ldquo;Download Certificate&rdquo; or &ldquo;Open in New Tab&rdquo; options above.
          </p>
        </section>
      </main>
    </div>
  );
}
