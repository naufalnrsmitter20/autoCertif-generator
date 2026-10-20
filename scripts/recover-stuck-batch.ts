import { prisma } from "../lib/prisma";
import { BatchStatus, CertificateStatus } from "../generated/prisma/client";

async function main() {
  console.log("Checking for batches stuck in GENERATING status...");

  const stuckBatches = await prisma.certificateBatch.findMany({
    where: {
      status: BatchStatus.GENERATING,
      deletedAt: null,
    },
    include: {
      certificates: {
        where: { deletedAt: null },
        select: { id: true, status: true, generationKey: true },
      },
    },
  });

  if (stuckBatches.length === 0) {
    console.log("No stuck batches found.");
    process.exit(0);
  }

  for (const batch of stuckBatches) {
    console.log(`Found batch [${batch.id}] "${batch.name}" in GENERATING status.`);
    console.log(`Current generationKey: ${batch.currentGenerationKey}`);
    console.log(`Total certificates count: ${batch.certificates.length}`);

    const hasStartedOrGenerated = batch.certificates.some(
      (c) => c.status === CertificateStatus.GENERATING || c.status === CertificateStatus.GENERATED
    );

    if (hasStartedOrGenerated) {
      console.log(
        `Batch [${batch.id}] has certificates that have already started or finished. Skipping auto-reset to avoid data loss.`
      );
      continue;
    }

    // All certificates are PENDING or empty. Safe to rollback to DRAFT.
    await prisma.$transaction(async (tx) => {
      const deletedCerts = await tx.certificate.deleteMany({
        where: {
          batchId: batch.id,
          generationKey: batch.currentGenerationKey,
          status: CertificateStatus.PENDING,
        },
      });

      await tx.certificateBatch.update({
        where: { id: batch.id },
        data: {
          status: BatchStatus.DRAFT,
          currentGenerationKey: null,
        },
      });

      console.log(
        `Successfully recovered batch [${batch.id}]: deleted ${deletedCerts.count} pending certificates and reset status to DRAFT.`
      );
    });
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Error running recover-stuck-batch script:", err);
  process.exit(1);
});
