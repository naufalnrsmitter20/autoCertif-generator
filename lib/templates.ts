import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guard";
import { BatchStatus, CertificateTemplate } from "@/generated/prisma/client";
import { BatchNotFoundError } from "@/lib/batches";
import {
  preliminaryUploadInputSchema,
  finalizeTemplateInputSchema,
  validateExtensionMatchesMime,
  getCanonicalExtension,
  validateStoragePathNamespace,
  validateTemplateBytes,
  sanitizeTemplateName,
  PreliminaryUploadInput,
  FinalizeTemplateInput,
  TemplateValidationError,
} from "@/lib/validations/template-file";
import {
  createTemplateSignedUploadUrl,
  downloadTemplateBuffer,
  deleteTemplateObject,
  createTemplateSignedReadUrl,
} from "@/lib/storage/server";

export class TemplateEligibilityError extends Error {
  constructor(message = "Templates can only be configured or replaced for batches in DRAFT status.") {
    super(message);
    this.name = "TemplateEligibilityError";
  }
}

export class ConcurrentModificationError extends Error {
  constructor(message = "Batch state changed concurrently. Template finalization aborted.") {
    super(message);
    this.name = "ConcurrentModificationError";
  }
}

/**
 * Initiates the template upload flow:
 * 1. Checks requireAdmin()
 * 2. Verifies active batch exists and is in DRAFT status
 * 3. Validates preliminary metadata
 * 4. Generates a collision-resistant unique storage path in templates/{batchId}/{uuid}.{ext}
 * 5. Issues a signed upload URL from Supabase with { upsert: false }
 */
export async function initiateTemplateUpload(
  batchId: string,
  input: PreliminaryUploadInput
): Promise<{ signedUrl: string; token: string; storagePath: string }> {
  await requireAdmin();

  const validated = preliminaryUploadInputSchema.parse(input);

  // Check batch eligibility
  const batch = await prisma.certificateBatch.findFirst({
    where: {
      id: batchId,
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.status !== BatchStatus.DRAFT) {
    throw new TemplateEligibilityError();
  }

  // Verify filename extension matches declared MIME
  const ext = validated.filename.slice(validated.filename.lastIndexOf("."));
  if (!validateExtensionMatchesMime(ext, validated.mimeType)) {
    throw new TemplateValidationError(
      `File extension "${ext}" does not match declared file type "${validated.mimeType}".`
    );
  }

  // Generate unique collision-resistant storage path
  const canonicalExt = getCanonicalExtension(validated.mimeType);
  const candidateId = crypto.randomUUID();
  const storagePath = `templates/${batchId}/${candidateId}${canonicalExt}`;

  // Create signed upload URL on Supabase with non-overwrite constraint
  const { signedUrl, token } = await createTemplateSignedUploadUrl(storagePath);

  return {
    signedUrl,
    token,
    storagePath,
  };
}

/**
 * Finalizes an uploaded candidate template:
 * 1. Checks requireAdmin()
 * 2. Re-verifies batch exists, is active (deletedAt === null), and status === DRAFT
 * 3. Captures expected current templateId
 * 4. Downloads uploaded bytes from Supabase Storage
 * 5. Authoritatively validates bytes (single-page PDF or valid image, dimensions, format match)
 * 6. Atomically creates CertificateTemplate and updates batch.templateId in a transaction
 * 7. Soft-deletes previous template only if no other active batch references it
 * 8. Executes compensating cleanup on storage if byte validation or database transaction fails
 */
export async function finalizeTemplateUpload(
  batchId: string,
  input: FinalizeTemplateInput
): Promise<CertificateTemplate> {
  await requireAdmin();

  const validated = finalizeTemplateInputSchema.parse(input);

  // Pre-check batch eligibility before downloading bytes
  const batch = await prisma.certificateBatch.findFirst({
    where: {
      id: batchId,
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      templateId: true,
    },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (batch.status !== BatchStatus.DRAFT) {
    throw new TemplateEligibilityError();
  }

  const expectedCurrentTemplateId = batch.templateId;

  // Validate storage path namespace
  const { isValid } = validateStoragePathNamespace(validated.storagePath, batchId);
  if (!isValid) {
    throw new TemplateValidationError("Invalid storage path namespace for this batch.");
  }

  // Download uploaded candidate bytes from Supabase Storage
  let buffer: Buffer;
  try {
    buffer = await downloadTemplateBuffer(validated.storagePath);
  } catch (error) {
    throw new TemplateValidationError(
      `Candidate file could not be retrieved from storage: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  // Authoritatively validate file bytes
  let validatedResult;
  try {
    validatedResult = await validateTemplateBytes(
      buffer,
      validated.declaredMimeType,
      validated.storagePath,
      batchId
    );
  } catch (validationError) {
    // Compensating cleanup of invalid candidate object
    try {
      await deleteTemplateObject(validated.storagePath);
    } catch (cleanErr) {
      console.error(
        `Failed to delete invalid candidate storage object ${validated.storagePath}:`,
        cleanErr
      );
    }
    throw validationError;
  }

  // Atomic database assignment with stale/concurrent guard
  const sanitizedName = sanitizeTemplateName(validated.originalFilename);

  try {
    const newTemplate = await prisma.$transaction(async (tx) => {
      // 1. Create the new CertificateTemplate record
      const created = await tx.certificateTemplate.create({
        data: {
          name: sanitizedName,
          fileType: validatedResult.fileType,
          sourceFilePath: validated.storagePath,
          pageWidth: validatedResult.width,
          pageHeight: validatedResult.height,
          deletedAt: null,
          // All Phase 5 fields remain null as per contract
        },
      });

      // 2. Atomically update batch only if still active, DRAFT, and matching expected templateId
      const updateResult = await tx.certificateBatch.updateMany({
        where: {
          id: batchId,
          deletedAt: null,
          status: BatchStatus.DRAFT,
          templateId: expectedCurrentTemplateId,
        },
        data: {
          templateId: created.id,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConcurrentModificationError(
          "Batch was modified or is no longer in DRAFT status during finalization. Aborting template assignment."
        );
      }

      // 3. If replacing an existing template, soft-delete it ONLY if no other active batch references it
      if (expectedCurrentTemplateId) {
        const otherBatchReferences = await tx.certificateBatch.count({
          where: {
            templateId: expectedCurrentTemplateId,
            deletedAt: null,
            id: { not: batchId },
          },
        });

        if (otherBatchReferences === 0) {
          await tx.certificateTemplate.update({
            where: { id: expectedCurrentTemplateId },
            data: {
              deletedAt: new Date(),
            },
          });
        }
      }

      return created;
    });

    return newTemplate;
  } catch (txError) {
    // Compensating cleanup: remove the candidate object from storage on transaction failure
    try {
      await deleteTemplateObject(validated.storagePath);
    } catch (cleanErr) {
      console.error(
        `Failed to clean up candidate storage object ${validated.storagePath} after transaction failure:`,
        cleanErr
      );
    }
    throw txError;
  }
}

/**
 * Generates a short-lived signed preview URL for the batch's active template.
 */
export async function getTemplatePreviewSignedUrl(batchId: string): Promise<string> {
  await requireAdmin();

  const batch = await prisma.certificateBatch.findFirst({
    where: {
      id: batchId,
      deletedAt: null,
    },
    include: {
      template: true,
    },
  });

  if (!batch) {
    throw new BatchNotFoundError();
  }

  if (!batch.template || !batch.template.sourceFilePath || batch.template.deletedAt) {
    throw new Error("No active template configured for this batch.");
  }

  return createTemplateSignedReadUrl(batch.template.sourceFilePath);
}
