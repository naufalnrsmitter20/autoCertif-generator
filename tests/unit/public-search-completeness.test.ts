import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { searchPublishedCertificates } from "@/lib/search/service";
import { BatchStatus, CertificateStatus } from "@/generated/prisma/client";

describe("Public Certificate Search — Result Completeness (>100 matches)", () => {
  const runId = Date.now();
  const templateId = `tpl-comp-${runId}`;
  const batch1Id = `batch-comp-1-${runId}`;
  const batch2Id = `batch-comp-2-${runId}`;

  const createdBatchIds = [batch1Id, batch2Id];
  const TOTAL_TEST_COUNT = 105; // > 100 to prove no hard 100-result truncation

  beforeAll(async () => {
    // 1. Create template
    await prisma.certificateTemplate.create({
      data: {
        id: templateId,
        name: "Completeness Test Template",
        fileType: "PDF",
      },
    });

    // 2. Create two published batches
    await prisma.certificateBatch.create({
      data: {
        id: batch1Id,
        name: "Completeness Batch 1",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        templateId,
      },
    });

    await prisma.certificateBatch.create({
      data: {
        id: batch2Id,
        name: "Completeness Batch 2",
        status: BatchStatus.PUBLISHED,
        publishedAt: new Date(),
        templateId,
      },
    });

    // 3. Bulk seed 105 published certificates (60 in batch 1, 45 in batch 2)
    // All with unique suffix sharing the search term "CompletenessParticipant"
    const participantData = [];
    const certificateData = [];

    for (let i = 1; i <= TOTAL_TEST_COUNT; i++) {
      const pId = `part-comp-${runId}-${i}`;
      const cId = `cert-comp-${runId}-${i}`;
      const targetBatchId = i <= 60 ? batch1Id : batch2Id;
      const publishedName = `CompletenessParticipant Suffix${String(i).padStart(3, "0")}`;

      participantData.push({
        id: pId,
        batchId: targetBatchId,
        name: publishedName,
      });

      certificateData.push({
        id: cId,
        participantId: pId,
        batchId: targetBatchId,
        status: CertificateStatus.GENERATED,
        publishedName,
        publishedFilePath: `certificates/comp-${i}.pdf`,
      });
    }

    await prisma.participant.createMany({
      data: participantData,
    });

    await prisma.certificate.createMany({
      data: certificateData,
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
      where: { id: templateId },
    });
  });

  it("returns ALL 105 matching certificates across multiple published batches without hard truncation", async () => {
    const res = await searchPublishedCertificates("CompletenessParticipant");
    expect(res.status).toBe("success");
    if (res.status === "success") {
      const matchedComp = res.results.filter((r) =>
        r.publishedName.startsWith("CompletenessParticipant")
      );

      // Verify that all 105 records are returned
      expect(matchedComp.length).toBe(TOTAL_TEST_COUNT);

      // Verify deterministic ordering: publishedName ASC, id ASC
      for (let i = 0; i < matchedComp.length - 1; i++) {
        const current = matchedComp[i];
        const next = matchedComp[i + 1];
        expect(current.publishedName.localeCompare(next.publishedName)).toBeLessThanOrEqual(0);
      }
    }
  });
});
