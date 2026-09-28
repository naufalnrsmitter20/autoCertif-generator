import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { searchPublishedCertificates } from "@/lib/search/service";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";

describe("Public Certificate Search Service — Publication Snapshot Contract", () => {
  const runId = Date.now();
  const templateId = `tpl-search-${runId}`;
  const batch1Id = `batch-search-1-${runId}`;
  const batch2Id = `batch-search-2-${runId}`;

  // Keep track of IDs for cleanup
  const createdBatchIds: string[] = [batch1Id, batch2Id];
  const createdTemplateIds: string[] = [templateId];

  beforeAll(async () => {
    // Create template
    await prisma.certificateTemplate.create({
      data: {
        id: templateId,
        name: "Search Test Template",
        fileType: "PDF",
      },
    });

    // Create published batch 1
    await prisma.certificateBatch.create({
      data: {
        id: batch1Id,
        name: "Search Batch 1 (Published)",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        templateId,
      },
    });

    // Create unpublished batch 2
    await prisma.certificateBatch.create({
      data: {
        id: batch2Id,
        name: "Search Batch 2 (Unpublished)",
        status: BatchStatus.GENERATED,
        publishedAt: null,
        templateId,
      },
    });
  });

  afterAll(async () => {
    // Teardown
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

  // A. Basic search: "naufal" matches "Naufal Nabil Ramadhan"
  it("A. matches partial substring at start of publishedName", async () => {
    const p = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Naufal Nabil Ramadhan" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Naufal Nabil Ramadhan",
        publishedFilePath: "certificates/naufal.pdf",
      },
    });

    const res = await searchPublishedCertificates("naufal");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      const match = res.results.find((r) => r.certificateId === cert.id);
      expect(match).toBeDefined();
      expect(match?.publishedName).toBe("Naufal Nabil Ramadhan");
    }
  });

  // B. Case-insensitive search: "NAUFAL" matches "Naufal Nabil Ramadhan"
  it("B. matches case-insensitively with uppercase query", async () => {
    const res = await searchPublishedCertificates("NAUFAL");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      const names = res.results.map((r) => r.publishedName);
      expect(names).toContain("Naufal Nabil Ramadhan");
    }
  });

  // C. Partial middle substring: "Nabil" matches "Naufal Nabil Ramadhan"
  it("C. matches partial substring in the middle of publishedName", async () => {
    const res = await searchPublishedCertificates("Nabil");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      const names = res.results.map((r) => r.publishedName);
      expect(names).toContain("Naufal Nabil Ramadhan");
    }
  });

  // D. Trim query whitespace: "   naufal   "
  it("D. trims query whitespace automatically", async () => {
    const res = await searchPublishedCertificates("   naufal   ");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.query).toBe("naufal");
      const names = res.results.map((r) => r.publishedName);
      expect(names).toContain("Naufal Nabil Ramadhan");
    }
  });

  // E. Blank queries list eligible published certificates
  it("E. returns published certificates for empty or whitespace query", async () => {
    const emptyRes = await searchPublishedCertificates("");
    const wsRes = await searchPublishedCertificates("     ");
    expect(emptyRes.status).toBe("success");
    expect(wsRes.status).toBe("success");
    if (emptyRes.status === "success" && wsRes.status === "success") {
      expect(emptyRes.query).toBe("");
      expect(wsRes.query).toBe("");
      expect(emptyRes.results).toEqual(wsRes.results);
      expect(emptyRes.results.some((r) => r.publishedName === "Naufal Nabil Ramadhan")).toBe(true);
    }
  });

  // F. Duplicate names: 2 distinct published certificates with identical name return both
  it("F. returns all distinct matching certificates for duplicate published names", async () => {
    const p1 = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Budi Santoso" },
    });
    const c1 = await prisma.certificate.create({
      data: {
        participantId: p1.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Budi Santoso",
        publishedFilePath: "certificates/budi1.pdf",
      },
    });

    const p2 = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Budi Santoso" },
    });
    const c2 = await prisma.certificate.create({
      data: {
        participantId: p2.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Budi Santoso",
        publishedFilePath: "certificates/budi2.pdf",
      },
    });

    const res = await searchPublishedCertificates("Budi Santoso");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      const matches = res.results.filter((r) => r.publishedName === "Budi Santoso");
      expect(matches.length).toBeGreaterThanOrEqual(2);
      const matchIds = matches.map((m) => m.certificateId);
      expect(matchIds).toContain(c1.id);
      expect(matchIds).toContain(c2.id);
    }
  });

  // G. Unpublished batch: publishedAt == null excluded
  it("G. excludes certificates belonging to unpublished batches", async () => {
    const pUnpub = await prisma.participant.create({
      data: { batchId: batch2Id, name: "Secret Unpublished Participant" },
    });
    const cUnpub = await prisma.certificate.create({
      data: {
        participantId: pUnpub.id,
        batchId: batch2Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Secret Unpublished Participant",
        publishedFilePath: "certificates/secret.pdf",
      },
    });

    const res = await searchPublishedCertificates("Secret Unpublished");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      const match = res.results.find((r) => r.certificateId === cUnpub.id);
      expect(match).toBeUndefined();
    }
  });

  // H. Soft-deleted batch excluded
  it("H. excludes certificates from soft-deleted batches", async () => {
    const delBatch = await prisma.certificateBatch.create({
      data: {
        name: "Deleted Batch",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        deletedAt: new Date(),
        templateId,
      },
    });
    createdBatchIds.push(delBatch.id);

    const p = await prisma.participant.create({
      data: { batchId: delBatch.id, name: "Deleted Batch Participant" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: delBatch.id,
        status: CertificateStatus.GENERATED,
        publishedName: "Deleted Batch Participant",
        publishedFilePath: "certificates/del-batch.pdf",
      },
    });

    const res = await searchPublishedCertificates("Deleted Batch Participant");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.results.some((r) => r.certificateId === cert.id)).toBe(false);
    }
  });

  // I. Soft-deleted Participant excluded
  it("I. excludes certificates belonging to soft-deleted participants", async () => {
    const p = await prisma.participant.create({
      data: {
        batchId: batch1Id,
        name: "Deleted Participant Name",
        deletedAt: new Date(),
      },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Deleted Participant Name",
        publishedFilePath: "certificates/del-part.pdf",
      },
    });

    const res = await searchPublishedCertificates("Deleted Participant Name");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.results.some((r) => r.certificateId === cert.id)).toBe(false);
    }
  });

  // J. Soft-deleted Certificate excluded
  it("J. excludes soft-deleted certificates", async () => {
    const p = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Soft Deleted Certificate Subject" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Soft Deleted Certificate Subject",
        publishedFilePath: "certificates/del-cert.pdf",
        deletedAt: new Date(),
      },
    });

    const res = await searchPublishedCertificates("Soft Deleted Certificate Subject");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.results.some((r) => r.certificateId === cert.id)).toBe(false);
    }
  });

  // K. Missing published snapshot excluded
  it("K. excludes certificates where publishedName or publishedFilePath is null", async () => {
    const p1 = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Missing Snapshot File" },
    });
    const c1 = await prisma.certificate.create({
      data: {
        participantId: p1.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Missing Snapshot File",
        publishedFilePath: null,
      },
    });

    const p2 = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Missing Snapshot Name" },
    });
    const c2 = await prisma.certificate.create({
      data: {
        participantId: p2.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: null,
        publishedFilePath: "certificates/somefile.pdf",
      },
    });

    const res1 = await searchPublishedCertificates("Missing Snapshot File");
    expect(res1.status).toBe("success");
    if (res1.status === "success") {
      expect(res1.results.some((r) => r.certificateId === c1.id)).toBe(false);
    }

    const res2 = await searchPublishedCertificates("Missing Snapshot Name");
    expect(res2.status).toBe("success");
    if (res2.status === "success") {
      expect(res2.results.some((r) => r.certificateId === c2.id)).toBe(false);
    }
  });

  // L. Published replacement IN PROGRESS: Participant.name = NEW, publishedName = OLD, batch.status = GENERATING
  it("L. searches old publishedName and rejects new uncommitted Participant.name during replacement", async () => {
    const repBatch = await prisma.certificateBatch.create({
      data: {
        name: "Replacement in Progress Batch",
        status: BatchStatus.GENERATING,
        publishedAt: new Date(),
        templateId,
      },
    });
    createdBatchIds.push(repBatch.id);

    const p = await prisma.participant.create({
      data: { batchId: repBatch.id, name: "Budi Santoso Edited Name" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: repBatch.id,
        status: CertificateStatus.PENDING,
        isStale: true,
        publishedName: "Budi Santoso Original Name",
        publishedFilePath: "certificates/orig.pdf",
      },
    });

    // 1. Searching OLD publishedName MUST find the certificate
    const resOld = await searchPublishedCertificates("Original Name");
    expect(resOld.status).toBe("success");
    if (resOld.status === "success") {
      expect(resOld.results.some((r) => r.certificateId === cert.id)).toBe(true);
    }

    // 2. Searching NEW Participant.name MUST NOT find it yet
    const resNew = await searchPublishedCertificates("Edited Name");
    expect(resNew.status).toBe("success");
    if (resNew.status === "success") {
      expect(resNew.results.some((r) => r.certificateId === cert.id)).toBe(false);
    }
  });

  // M. Published replacement FAILED: Participant.name = NEW, cert.status = FAILED, isStale = true, publishedName = OLD
  it("M. keeps old published snapshot searchable when replacement generation fails", async () => {
    const p = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Failed New Replacement Name" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: batch1Id,
        status: CertificateStatus.FAILED,
        generationError: "NAME_DOES_NOT_FIT",
        isStale: true,
        publishedName: "Stable Old Snapshot Name",
        publishedFilePath: "certificates/stable.pdf",
      },
    });

    // Searching OLD snapshot name MUST still find the certificate
    const resOld = await searchPublishedCertificates("Stable Old Snapshot Name");
    expect(resOld.status).toBe("success");
    if (resOld.status === "success") {
      expect(resOld.results.some((r) => r.certificateId === cert.id)).toBe(true);
    }

    // Searching NEW name MUST NOT match
    const resNew = await searchPublishedCertificates("Failed New Replacement Name");
    expect(resNew.status).toBe("success");
    if (resNew.status === "success") {
      expect(resNew.results.some((r) => r.certificateId === cert.id)).toBe(false);
    }
  });

  // N. Successful cutover: publishedName transitions from OLD -> NEW
  it("N. updates search visibility after successful publication cutover", async () => {
    const p = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Cutover Participant" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Pre-Cutover Name",
        publishedFilePath: "certificates/pre.pdf",
      },
    });

    // Initial check: matches OLD
    const resPre = await searchPublishedCertificates("Pre-Cutover");
    expect(resPre.status).toBe("success");
    if (resPre.status === "success") {
      expect(resPre.results.some((r) => r.certificateId === cert.id)).toBe(true);
    }

    // Simulate cutover: update publishedName to NEW
    await prisma.certificate.update({
      where: { id: cert.id },
      data: {
        publishedName: "Post-Cutover Name",
        publishedFilePath: "certificates/post.pdf",
      },
    });

    // Old name no longer matches
    const resOldAfter = await searchPublishedCertificates("Pre-Cutover");
    expect(resOldAfter.status).toBe("success");
    if (resOldAfter.status === "success") {
      expect(resOldAfter.results.some((r) => r.certificateId === cert.id)).toBe(false);
    }

    // New name now matches
    const resNewAfter = await searchPublishedCertificates("Post-Cutover");
    expect(resNewAfter.status).toBe("success");
    if (resNewAfter.status === "success") {
      expect(resNewAfter.results.some((r) => r.certificateId === cert.id)).toBe(true);
    }
  });

  // O. Unpublish immediately removes certificates from search
  it("O. removes certificate immediately when batch publishedAt is cleared", async () => {
    const tempBatch = await prisma.certificateBatch.create({
      data: {
        name: "Unpublish Test Batch",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        templateId,
      },
    });
    createdBatchIds.push(tempBatch.id);

    const p = await prisma.participant.create({
      data: { batchId: tempBatch.id, name: "Unpublish Candidate" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: tempBatch.id,
        status: CertificateStatus.GENERATED,
        publishedName: "Unpublish Candidate",
        publishedFilePath: "certificates/unpub-cand.pdf",
      },
    });

    // Visible when published
    const resBefore = await searchPublishedCertificates("Unpublish Candidate");
    expect(resBefore.status).toBe("success");
    if (resBefore.status === "success") {
      expect(resBefore.results.some((r) => r.certificateId === cert.id)).toBe(true);
    }

    // Unpublish batch
    await prisma.certificateBatch.update({
      where: { id: tempBatch.id },
      data: { publishedAt: null, status: BatchStatus.GENERATED },
    });

    // Immediately invisible even though publishedName and publishedFilePath remain in DB
    const resAfter = await searchPublishedCertificates("Unpublish Candidate");
    expect(resAfter.status).toBe("success");
    if (resAfter.status === "success") {
      expect(resAfter.results.some((r) => r.certificateId === cert.id)).toBe(false);
    }
  });

  // P. Batch status FAILED but publishedAt != null remains searchable
  it("P. keeps published certificates searchable when batch operational status is FAILED", async () => {
    const failedBatch = await prisma.certificateBatch.create({
      data: {
        name: "Batch with Operational Failure",
        status: BatchStatus.FAILED,
        publishedAt: new Date(),
        templateId,
      },
    });
    createdBatchIds.push(failedBatch.id);

    const p = await prisma.participant.create({
      data: { batchId: failedBatch.id, name: "Operational Survivor" },
    });
    const cert = await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId: failedBatch.id,
        status: CertificateStatus.GENERATED,
        publishedName: "Operational Survivor",
        publishedFilePath: "certificates/survivor.pdf",
      },
    });

    const res = await searchPublishedCertificates("Operational Survivor");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.results.some((r) => r.certificateId === cert.id)).toBe(true);
    }
  });

  // Q. Literal LIKE characters (% and _)
  it("Q. handles literal % and _ without accidental wildcard matching", async () => {
    const p1 = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Alice % Bob" },
    });
    const c1 = await prisma.certificate.create({
      data: {
        participantId: p1.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Alice % Bob",
        publishedFilePath: "certificates/pct.pdf",
      },
    });

    const p2 = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Alice and Bob" },
    });
    const c2 = await prisma.certificate.create({
      data: {
        participantId: p2.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Alice and Bob",
        publishedFilePath: "certificates/and.pdf",
      },
    });

    const p3 = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Charlie_Brown" },
    });
    const c3 = await prisma.certificate.create({
      data: {
        participantId: p3.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Charlie_Brown",
        publishedFilePath: "certificates/under.pdf",
      },
    });

    const p4 = await prisma.participant.create({
      data: { batchId: batch1Id, name: "Charlie-Brown" },
    });
    const c4 = await prisma.certificate.create({
      data: {
        participantId: p4.id,
        batchId: batch1Id,
        status: CertificateStatus.GENERATED,
        publishedName: "Charlie-Brown",
        publishedFilePath: "certificates/dash.pdf",
      },
    });

    // 1. Literal search for "%" must match "Alice % Bob" and NOT "Alice and Bob"
    const resPct = await searchPublishedCertificates("%");
    expect(resPct.status).toBe("success");
    if (resPct.status === "success") {
      const matchIds = resPct.results.map((r) => r.certificateId);
      expect(matchIds).toContain(c1.id);
      expect(matchIds).not.toContain(c2.id);
    }

    // 2. Literal search for "_" must match "Charlie_Brown" and NOT "Charlie-Brown"
    const resUnderscore = await searchPublishedCertificates("Charlie_Brown");
    expect(resUnderscore.status).toBe("success");
    if (resUnderscore.status === "success") {
      const matchIds = resUnderscore.results.map((r) => r.certificateId);
      expect(matchIds).toContain(c3.id);
      expect(matchIds).not.toContain(c4.id);
    }
  });
});
