-- AlterTable
ALTER TABLE "certificate_batches" ADD COLUMN     "currentGenerationKey" TEXT;

-- AlterTable
ALTER TABLE "certificates" ADD COLUMN     "generationKey" TEXT;
