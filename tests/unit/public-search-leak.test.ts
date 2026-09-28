import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { searchPublishedCertificates } from "@/lib/search/service";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";

describe("Public Search Security & Privacy — Zero Field Leakage", () => {
  const runId = Date.now();
  const templateId = `tpl-leak-${runId}`;
  const batchId = `batch-leak-${runId}`;

  beforeAll(async () => {
    await prisma.certificateTemplate.create({
      data: {
        id: templateId,
        name: "Leak Test Template",
        fileType: "PDF",
      },
    });

    await prisma.certificateBatch.create({
      data: {
        id: batchId,
        name: "Leak Test Batch",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        currentGenerationKey: "secret-batch-gen-key",
        templateId,
      },
    });

    const p = await prisma.participant.create({
      data: {
        batchId,
        name: "Confidential Subject",
      },
    });

    await prisma.certificate.create({
      data: {
        participantId: p.id,
        batchId,
        status: CertificateStatus.GENERATED,
        generationKey: "secret-cert-gen-key",
        generatedFilePath: "certificates/confidential-internal-path.pdf",
        publishedFilePath: "certificates/confidential-published-path.pdf",
        publishedName: "Confidential Subject",
      },
    });
  });

  afterAll(async () => {
    await prisma.certificate.deleteMany({ where: { batchId } });
    await prisma.participant.deleteMany({ where: { batchId } });
    await prisma.certificateBatch.deleteMany({ where: { id: batchId } });
    await prisma.certificateTemplate.deleteMany({ where: { id: templateId } });
  });

  it("strictly serializes ONLY certificateId and publishedName without internal fields", async () => {
    for (const query of ["Confidential Subject", ""]) {
      const res = await searchPublishedCertificates(query);
      expect(res.status).toBe("success");
      if (res.status !== "success") continue;
      expect(res.results.length).toBeGreaterThanOrEqual(1);
      const match = res.results.find((r) => r.publishedName === "Confidential Subject");
      expect(match).toBeDefined();

      // Check exact object keys
      const keys = Object.keys(match!).sort();
      expect(keys).toEqual(["certificateId", "publishedName"]);

      // Explicit non-disclosure assertions
      const record = match as Record<string, unknown>;
      expect(record.publishedFilePath).toBeUndefined();
      expect(record.generatedFilePath).toBeUndefined();
      expect(record.participantId).toBeUndefined();
      expect(record.batchId).toBeUndefined();
      expect(record.generationKey).toBeUndefined();
      expect(record.currentGenerationKey).toBeUndefined();
      expect(record.generationError).toBeUndefined();
      expect(record.isStale).toBeUndefined();
      expect(record.deletedAt).toBeUndefined();
      expect(record.storageUrl).toBeUndefined();
      expect(record.bucket).toBeUndefined();
    }
  });
});
