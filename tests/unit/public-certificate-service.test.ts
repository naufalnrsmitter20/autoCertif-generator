import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getPublishedCertificateById,
  verifyPublishedCertificateSnapshot,
} from "@/lib/public-certificates/service";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";

describe("Public Certificate Service — Eligibility & Security Contract", () => {
  const runId = Date.now();
  const templateId = `tpl-pubcert-${runId}`;
  const publishedBatchId = `batch-pubcert-pub-${runId}`;
  const unpublishedBatchId = `batch-pubcert-unpub-${runId}`;

  const createdBatchIds: string[] = [publishedBatchId, unpublishedBatchId];
  const createdTemplateIds: string[] = [templateId];

  beforeAll(async () => {
    await prisma.certificateTemplate.create({
      data: {
        id: templateId,
        name: "Public Cert Test Template",
        fileType: "PDF",
      },
    });

    await prisma.certificateBatch.create({
      data: {
        id: publishedBatchId,
        name: "Published Batch",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        templateId,
      },
    });

    await prisma.certificateBatch.create({
      data: {
        id: unpublishedBatchId,
        name: "Unpublished Batch",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        templateId,
      },
    });
  });

  afterAll(async () => {
    await prisma.certificate.deleteMany({
      where: { batchId: { in: createdBatchIds } },
    });
    await prisma.participant.deleteMany({
      where: { batchId: { in: createdBatchIds } },
    });
    await prisma.certificateBatch.deleteMany({
      where: { id: { in: createdBatchIds } },
    });
    await prisma.certificateTemplate.deleteMany({
      where: { id: { in: createdTemplateIds } },
    });
  });

  // A. Valid published certificate
  it("A. returns authoritative snapshot for valid published certificate", async () => {
    const p = await prisma.participant.create({
      data: { batchId: publishedBatchId, name: "Valid Participant" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: publishedBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: "Valid Participant",
        publishedFilePath: "certificates/valid.pdf",
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).not.toBeNull();
    expect(res?.id).toBe(cert.id);
    expect(res?.publishedName).toBe("Valid Participant");
    expect(res?.publishedFilePath).toBe("certificates/valid.pdf");

    // Recheck should succeed
    const recheck = await verifyPublishedCertificateSnapshot(cert.id, "certificates/valid.pdf");
    expect(recheck).toBe(true);
  });

  // B. Unknown certificate ID
  it("B. returns null for unknown certificate ID", async () => {
    const res = await getPublishedCertificateById("non-existent-cert-id");
    expect(res).toBeNull();

    const recheck = await verifyPublishedCertificateSnapshot("non-existent-cert-id", "any/path.pdf");
    expect(recheck).toBe(false);
  });

  // C. Unpublished batch
  it("C. returns null when batch publishedAt is null", async () => {
    const p = await prisma.participant.create({
      data: { batchId: unpublishedBatchId, name: "Unpublished Participant" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: unpublishedBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: "Unpublished Participant",
        publishedFilePath: "certificates/unpub.pdf",
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).toBeNull();

    const recheck = await verifyPublishedCertificateSnapshot(cert.id, "certificates/unpub.pdf");
    expect(recheck).toBe(false);
  });

  // D. Soft-deleted batch
  it("D. returns null when batch is soft-deleted", async () => {
    const delBatchId = `batch-pubcert-del-${runId}`;
    createdBatchIds.push(delBatchId);

    await prisma.certificateBatch.create({
      data: {
        id: delBatchId,
        name: "Deleted Batch",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        deletedAt: new Date(),
        templateId,
      },
    });

    const p = await prisma.participant.create({
      data: { batchId: delBatchId, name: "Deleted Batch Person" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: delBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: "Deleted Batch Person",
        publishedFilePath: "certificates/del-batch.pdf",
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).toBeNull();
  });

  // E. Soft-deleted participant
  it("E. returns null when participant is soft-deleted", async () => {
    const p = await prisma.participant.create({
      data: {
        batchId: publishedBatchId,
        name: "Deleted Person",
        deletedAt: new Date(),
      },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: publishedBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: "Deleted Person",
        publishedFilePath: "certificates/del-part.pdf",
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).toBeNull();
  });

  // F. Soft-deleted certificate
  it("F. returns null when certificate is soft-deleted", async () => {
    const p = await prisma.participant.create({
      data: { batchId: publishedBatchId, name: "Deleted Cert Person" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: publishedBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: "Deleted Cert Person",
        publishedFilePath: "certificates/del-cert.pdf",
        deletedAt: new Date(),
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).toBeNull();
  });

  // G. publishedName is null
  it("G. returns null when publishedName is null", async () => {
    const p = await prisma.participant.create({
      data: { batchId: publishedBatchId, name: "No Name Person" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: publishedBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: null,
        publishedFilePath: "certificates/no-name.pdf",
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).toBeNull();
  });

  // H. publishedFilePath is null
  it("H. returns null when publishedFilePath is null", async () => {
    const p = await prisma.participant.create({
      data: { batchId: publishedBatchId, name: "No File Person" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: publishedBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: "No File Person",
        publishedFilePath: null,
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).toBeNull();
  });

  // I. batch operational GENERATING + publishedAt non-null
  it("I. returns OLD published snapshot when batch is operational GENERATING with non-null publishedAt", async () => {
    const genBatchId = `batch-pubcert-gen-${runId}`;
    createdBatchIds.push(genBatchId);

    await prisma.certificateBatch.create({
      data: {
        id: genBatchId,
        name: "Generating Batch",
        status: BatchStatus.GENERATING,
        publishedAt: new Date(),
        templateId,
      },
    });

    const p = await prisma.participant.create({
      data: { batchId: genBatchId, name: "New In-Progress Name" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: genBatchId,
        status: CertificateStatus.PENDING,
        isStale: true,
        publishedName: "Old Active Published Name",
        publishedFilePath: "certificates/old-live.pdf",
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).not.toBeNull();
    expect(res?.publishedName).toBe("Old Active Published Name");
    expect(res?.publishedFilePath).toBe("certificates/old-live.pdf");
  });

  // J. batch operational FAILED + publishedAt non-null
  it("J. returns OLD published snapshot when batch is operational FAILED with non-null publishedAt", async () => {
    const failBatchId = `batch-pubcert-fail-${runId}`;
    createdBatchIds.push(failBatchId);

    await prisma.certificateBatch.create({
      data: {
        id: failBatchId,
        name: "Failed Batch",
        status: BatchStatus.FAILED,
        publishedAt: new Date(),
        templateId,
      },
    });

    const p = await prisma.participant.create({
      data: { batchId: failBatchId, name: "Failed Batch Person" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: failBatchId,
        status: CertificateStatus.FAILED,
        isStale: true,
        publishedName: "Old Stable Name",
        publishedFilePath: "certificates/old-stable.pdf",
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).not.toBeNull();
    expect(res?.publishedName).toBe("Old Stable Name");
    expect(res?.publishedFilePath).toBe("certificates/old-stable.pdf");
  });

  // K. Certificate status FAILED / isStale true but valid published snapshot
  it("K. returns OLD published snapshot when individual certificate is FAILED but has valid published snapshot", async () => {
    const p = await prisma.participant.create({
      data: { batchId: publishedBatchId, name: "Failed Part Person" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: publishedBatchId,
        status: CertificateStatus.FAILED,
        isStale: true,
        publishedName: "Pre-Failure Published Name",
        publishedFilePath: "certificates/pre-fail.pdf",
      },
    });

    const res = await getPublishedCertificateById(cert.id);
    expect(res).not.toBeNull();
    expect(res?.publishedName).toBe("Pre-Failure Published Name");
  });

  // L. verifyPublishedCertificateSnapshot detects snapshot path change
  it("L. verifyPublishedCertificateSnapshot returns false when publishedFilePath has changed", async () => {
    const p = await prisma.participant.create({
      data: { batchId: publishedBatchId, name: "Path Changing Person" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: publishedBatchId,
        status: CertificateStatus.GENERATED,
        publishedName: "Path Changing Person",
        publishedFilePath: "certificates/path-v1.pdf",
      },
    });

    // Check with correct path
    expect(await verifyPublishedCertificateSnapshot(cert.id, "certificates/path-v1.pdf")).toBe(true);

    // Check with stale/different path
    expect(await verifyPublishedCertificateSnapshot(cert.id, "certificates/path-v2.pdf")).toBe(false);
  });
});
