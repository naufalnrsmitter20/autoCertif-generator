import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import { PDFDocument } from "pdf-lib";
import {
  getServerStorageClient,
  uploadGeneratedCertificate,
  createCertificateSignedReadUrl,
} from "@/lib/storage/server";
import { GENERATED_CERTIFICATES_BUCKET } from "@/lib/storage/constants";
import {
  getPublishedCertificateById,
  verifyPublishedCertificateSnapshot,
} from "@/lib/public-certificates/service";
import { sanitizeDownloadFilename } from "@/lib/public-certificates/filename";
import { BatchStatus, CertificateStatus, TemplateFileType } from "@/generated/prisma/client";

describe("Phase 13 Live Supabase Storage & Public Delivery Integration", { timeout: 60000 }, () => {
  const timestamp = Date.now();
  const testTemplateId = `tpl-live-p13-${timestamp}`;
  const testBatchId = `batch-live-p13-${timestamp}`;
  const certStoragePath = `certificates/${testBatchId}/test-part/${timestamp}.pdf`;

  let participantId: string;
  let certificateId: string;
  let previewSignedUrl: string;
  let downloadSignedUrl: string;

  async function withRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err: unknown) {
        if (i === retries - 1) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("EAI_AGAIN") ||
          msg.includes("timeout") ||
          msg.includes("ECONNRESET") ||
          msg.includes("fetch failed") ||
          msg.includes("Can't reach database server")
        ) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Retry exhausted");
  }

  beforeAll(async () => {
    // 1. Generate real minimal single-page PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([842, 595]);
    const pdfBytes = await pdfDoc.save();

    // 2. Upload to private generated-certificates bucket
    await withRetry(async () => {
      await uploadGeneratedCertificate(certStoragePath, pdfBytes);
    });

    // 3. Create Template record
    await withRetry(() =>
      prisma.certificateTemplate.create({
        data: {
          id: testTemplateId,
          name: `Phase 13 Test Template ${timestamp}`,
          fileType: TemplateFileType.PDF,
          sourceFilePath: "templates/dummy.pdf",
          pageWidth: 842,
          pageHeight: 595,
        },
      })
    );

    // 4. Create Published Batch
    await withRetry(() =>
      prisma.certificateBatch.create({
        data: {
          id: testBatchId,
          name: `Phase 13 Published Batch ${timestamp}`,
          status: BatchStatus.PUBLISHED,
          publishedAt: new Date(),
          templateId: testTemplateId,
        },
      })
    );

    // 5. Create Participant
    const part = await withRetry(() =>
      prisma.participant.create({
        data: {
          batchId: testBatchId,
          name: "Siti Rahmawati",
        },
      })
    );
    participantId = part.id;

    // 6. Create Certificate with published snapshot
    const cert = await withRetry(() =>
      prisma.certificate.create({
        data: {
          participantId,
          batchId: testBatchId,
          status: CertificateStatus.GENERATED,
          publishedName: "Siti Rahmawati",
          publishedFilePath: certStoragePath,
        },
      })
    );
    certificateId = cert.id;
  });

  afterAll(async () => {
    // Clean up Supabase Storage
    const supabase = getServerStorageClient();
    await supabase.storage
      .from(GENERATED_CERTIFICATES_BUCKET)
      .remove([certStoragePath])
      .catch(() => {});

    // Clean up DB records
    await prisma.certificate.deleteMany({ where: { batchId: testBatchId } }).catch(() => {});
    await prisma.participant.deleteMany({ where: { batchId: testBatchId } }).catch(() => {});
    await prisma.certificateBatch.deleteMany({ where: { id: testBatchId } }).catch(() => {});
    await prisma.certificateTemplate.deleteMany({ where: { id: testTemplateId } }).catch(() => {});
  });

  it("Step 1: Bucket generated-certificates is strictly private", async () => {
    const supabase = getServerStorageClient();
    const { data: bucket, error } = await supabase.storage.getBucket(GENERATED_CERTIFICATES_BUCKET);
    expect(error).toBeNull();
    expect(bucket?.public).toBe(false);
  });

  it("Step 2: Preview signed URL resolves to valid PDF with application/pdf Content-Type", async () => {
    const cert = await getPublishedCertificateById(certificateId);
    expect(cert).not.toBeNull();

    previewSignedUrl = await createCertificateSignedReadUrl(cert!.publishedFilePath, 300);
    expect(previewSignedUrl).toContain("token=");

    // Fetch the signed URL using native HTTP GET
    const response = await fetch(previewSignedUrl);
    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("application/pdf");

    // Verify magic bytes: %PDF-
    const arrayBuffer = await response.arrayBuffer();
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
    const headerStr = String.fromCharCode(...headerBytes);
    expect(headerStr).toBe("%PDF-");
  });

  it("Step 3: Download signed URL sets Content-Disposition with sanitized filename", async () => {
    const cert = await getPublishedCertificateById(certificateId);
    expect(cert).not.toBeNull();

    const filename = sanitizeDownloadFilename(cert!.publishedName);
    expect(filename).toBe("certificate-siti-rahmawati.pdf");

    downloadSignedUrl = await createCertificateSignedReadUrl(cert!.publishedFilePath, 300, filename);
    expect(downloadSignedUrl).toContain("download=certificate-siti-rahmawati.pdf");

    const response = await fetch(downloadSignedUrl);
    expect(response.status).toBe(200);

    const contentDisposition = response.headers.get("content-disposition");
    expect(contentDisposition).toContain("attachment");
    expect(contentDisposition).toContain("certificate-siti-rahmawati.pdf");
  });

  it("Step 4: Unpublish immediately terminates public eligibility", async () => {
    // Unpublish batch
    await prisma.certificateBatch.update({
      where: { id: testBatchId },
      data: { publishedAt: null, status: BatchStatus.GENERATED },
    });

    // Lookup should immediately return null
    const certAfter = await getPublishedCertificateById(certificateId);
    expect(certAfter).toBeNull();

    // Recheck should immediately return false
    const recheck = await verifyPublishedCertificateSnapshot(certificateId, certStoragePath);
    expect(recheck).toBe(false);
  });
});
