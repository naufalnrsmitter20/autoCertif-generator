import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";
import * as storageServer from "@/lib/storage/server";
import { verifyPublishedCertificateSnapshot } from "@/lib/public-certificates/service";
import { GET as downloadRouteHandler } from "@/app/certificates/[certificateId]/download/route";

describe("Public Certificate Signing Race-Safety Tests (Requirement 7)", () => {
  const runId = Date.now();
  const templateId = `tpl-race-${runId}`;
  const raceBatchId = `batch-race-${runId}`;

  let certificateId: string;

  beforeAll(async () => {
    await prisma.certificateTemplate.create({
      data: {
        id: templateId,
        name: "Race Test Template",
        fileType: "PDF",
      },
    });

    await prisma.certificateBatch.create({
      data: {
        id: raceBatchId,
        name: "Race Published Batch",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        templateId,
      },
    });

    const p = await prisma.participant.create({
      data: { batchId: raceBatchId, name: "Race Participant" },
    });

    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: raceBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: "Race Participant",
        publishedFilePath: "certificates/race-initial.pdf",
      },
    });
    certificateId = cert.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.certificate.deleteMany({ where: { batchId: raceBatchId } });
    await prisma.participant.deleteMany({ where: { batchId: raceBatchId } });
    await prisma.certificateBatch.deleteMany({ where: { id: raceBatchId } });
    await prisma.certificateTemplate.deleteMany({ where: { id: templateId } });
  });

  // A. Detail request starts while published -> Unpublish occurs during signing -> final check fails
  it("A. Detail flow: in-flight unpublish during signing causes final recheck to fail", async () => {
    // Ensure published
    await prisma.certificateBatch.update({
      where: { id: raceBatchId },
      data: { publishedAt: new Date() },
    });

    const initialFilePath = "certificates/race-initial.pdf";

    // Simulate signing taking place while concurrent unpublish happens in the background
    const signSpy = vi.spyOn(storageServer, "createCertificateSignedReadUrl").mockImplementationOnce(async () => {
      // Simulate concurrent unpublish committing to DB
      await prisma.certificateBatch.update({
        where: { id: raceBatchId },
        data: { publishedAt: null },
      });
      return "https://mock.storage.supabase.co/signed-url-token";
    });

    // Sign executes
    const signedUrl = await storageServer.createCertificateSignedReadUrl(initialFilePath, 300);
    expect(signedUrl).toBeDefined();

    // Detail page Step 3 recheck executes:
    const isStillValid = await verifyPublishedCertificateSnapshot(certificateId, initialFilePath);

    // MUST be false because publishedAt was set to null
    expect(isStillValid).toBe(false);

    signSpy.mockRestore();
  });

  // B. Download request starts while published -> Unpublish occurs during signing -> HTTP 404 with no-store
  it("B. Download route: in-flight unpublish during signing returns HTTP 404 with Cache-Control: no-store", async () => {
    // Re-publish batch
    await prisma.certificateBatch.update({
      where: { id: raceBatchId },
      data: { publishedAt: new Date() },
    });

    const signSpy = vi.spyOn(storageServer, "createCertificateSignedReadUrl").mockImplementationOnce(async () => {
      // Simulate concurrent unpublish committing to DB while signing is in progress
      await prisma.certificateBatch.update({
        where: { id: raceBatchId },
        data: { publishedAt: null },
      });
      return "https://mock.storage.supabase.co/signed-download-url-token";
    });

    const req = new NextRequest(`http://localhost:3000/certificates/${certificateId}/download`);
    const res = await downloadRouteHandler(req, {
      params: Promise.resolve({ certificateId }),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // Verify it did NOT redirect
    expect(res.headers.get("Location")).toBeNull();

    signSpy.mockRestore();
  });

  // C. Published snapshot changes during signing OLD_FILE -> NEW_FILE -> final recheck fails
  it("C. Download route: snapshot change during signing prevents disclosure of obsolete URL", async () => {
    // Re-publish batch with initial file path
    await prisma.certificateBatch.update({
      where: { id: raceBatchId },
      data: { publishedAt: new Date() },
    });
    await prisma.certificate.update({
      where: { id: certificateId },
      data: {
        publishedFilePath: "certificates/race-initial.pdf",
        publishedName: "Race Participant",
      },
    });

    const signSpy = vi.spyOn(storageServer, "createCertificateSignedReadUrl").mockImplementationOnce(async () => {
      // Simulate Phase 11 replacement worker cutover committing to DB
      await prisma.certificate.update({
        where: { id: certificateId },
        data: {
          publishedFilePath: "certificates/race-replacement.pdf",
          publishedName: "Race Participant Updated",
        },
      });
      return "https://mock.storage.supabase.co/signed-old-url-token";
    });

    const req = new NextRequest(`http://localhost:3000/certificates/${certificateId}/download`);
    const res = await downloadRouteHandler(req, {
      params: Promise.resolve({ certificateId }),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Location")).toBeNull();

    signSpy.mockRestore();
  });

  // D. Normal published request -> signed URL returned successfully via 302 redirect with no-store
  it("D. Download route: normal published request redirects to signed URL with Cache-Control: no-store", async () => {
    // Re-publish batch and sync path
    await prisma.certificateBatch.update({
      where: { id: raceBatchId },
      data: { publishedAt: new Date() },
    });
    await prisma.certificate.update({
      where: { id: certificateId },
      data: {
        publishedFilePath: "certificates/race-stable.pdf",
        publishedName: "Race Participant Stable",
      },
    });

    const mockSignedUrl = "https://mock.storage.supabase.co/object/sign/generated-certificates/certificates/race-stable.pdf?token=abc&download=certificate-race-participant-stable.pdf";
    const signSpy = vi.spyOn(storageServer, "createCertificateSignedReadUrl").mockResolvedValueOnce(mockSignedUrl);

    const req = new NextRequest(`http://localhost:3000/certificates/${certificateId}/download`);
    const res = await downloadRouteHandler(req, {
      params: Promise.resolve({ certificateId }),
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(mockSignedUrl);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    signSpy.mockRestore();
  });
});
