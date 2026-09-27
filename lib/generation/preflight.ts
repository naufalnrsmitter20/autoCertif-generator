import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { BatchStatus, TemplateFileType } from "@/generated/prisma/client";
import { namePlacementSchema, NamePlacement } from "@/lib/coordinates";
import { parseFontConfig } from "@/lib/rendering/font-config";
import { resolveFontBytes } from "@/lib/rendering/font-registry";
import {
  validatePdfPageGeometry,
  RenderCertificateStyle,
} from "@/lib/rendering/geometry";
import type { Metadata } from "sharp";
import { downloadTemplateBuffer } from "@/lib/storage/server";
import { normalizeParticipantName } from "@/lib/participants/normalize";
import { GenerationPreflightError } from "./errors";

export interface ValidatedPreflightSnapshot {
  batchId: string;
  batchName: string;
  templateId: string;
  templateUpdatedAt: Date;
  templateFileType: TemplateFileType;
  templateSourceFilePath: string;
  namePlacement: NamePlacement;
  fontConfig: RenderCertificateStyle;
  fontAssetPath: string;
  activeParticipants: Array<{
    id: string;
    name: string;
    normalizedName: string;
  }>;
}

/**
 * Validates shared rendering prerequisites for a batch independent of its lifecycle status:
 * - Batch exists and is not soft-deleted
 * - Active template presence and non-deleted state
 * - Template sourceFilePath present
 * - NamePlacement spatial validation
 * - Deterministic font asset configuration and resolution
 * - fontConfig parsing and style validation
 * - Template source object accessibility and byte geometry validation
 * - Target participants (filtered if targetParticipantIds is passed, or all active participants)
 *   have count > 0 and valid non-blank normalized names.
 *
 * Catches ALL shared deterministic configuration and template failures without mutating DB.
 */
export async function validateRenderingPrerequisites(
  batchId: string,
  targetParticipantIds?: string[]
): Promise<ValidatedPreflightSnapshot> {
  // 1. Fetch batch with active template and participants
  const batch = await prisma.certificateBatch.findFirst({
    where: {
      id: batchId,
      deletedAt: null,
    },
    include: {
      template: true,
      participants: {
        where: {
          deletedAt: null,
          ...(targetParticipantIds && targetParticipantIds.length > 0
            ? { id: { in: targetParticipantIds } }
            : {}),
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!batch) {
    throw new GenerationPreflightError("Certificate batch not found or has been deleted.");
  }

  // 2. Validate template exists and is active
  if (!batch.template || batch.template.deletedAt) {
    throw new GenerationPreflightError(
      "No active certificate template is configured for this batch."
    );
  }

  const template = batch.template;

  if (!template.sourceFilePath) {
    throw new GenerationPreflightError(
      "Certificate template does not have a source file path."
    );
  }

  // 3. Validate namePlacement
  if (!template.namePlacement) {
    throw new GenerationPreflightError(
      "Participant name placement has not been configured. Position the name field before generating."
    );
  }

  const placementResult = namePlacementSchema.safeParse(template.namePlacement);
  if (!placementResult.success) {
    const errorDetails = placementResult.error.issues
      .map((i) => i.message)
      .join("; ");
    throw new GenerationPreflightError(
      `Template name placement is invalid: ${errorDetails}`
    );
  }
  const validatedPlacement: NamePlacement = placementResult.data;

  // 4. Validate fontAssetPath and resolve deterministic font bytes
  if (!template.fontAssetPath || template.fontAssetPath.trim().length === 0) {
    throw new GenerationPreflightError(
      "Deterministic font asset is not configured for this template. Real production font remains NOT CONFIGURED."
    );
  }

  try {
    await resolveFontBytes(template.fontAssetPath);
  } catch (fontError) {
    const msg = fontError instanceof Error ? fontError.message : String(fontError);
    throw new GenerationPreflightError(
      `Font asset configuration error: ${msg}`
    );
  }

  // 5. Validate fontConfig JSON
  if (!template.fontConfig) {
    throw new GenerationPreflightError(
      "Typography rendering style (fontConfig) is not configured for this template."
    );
  }

  let validatedStyle: RenderCertificateStyle;
  try {
    validatedStyle = parseFontConfig(template.fontConfig);
  } catch (styleError) {
    const msg = styleError instanceof Error ? styleError.message : String(styleError);
    throw new GenerationPreflightError(
      `Typography configuration error: ${msg}`
    );
  }

  // 6. Validate template source file accessibility and byte geometry
  let templateBuffer: Buffer;
  try {
    templateBuffer = await downloadTemplateBuffer(template.sourceFilePath);
  } catch (storageError) {
    const msg = storageError instanceof Error ? storageError.message : String(storageError);
    throw new GenerationPreflightError(
      `Failed to load template source file from storage: ${msg}`
    );
  }

  if (templateBuffer.length === 0) {
    throw new GenerationPreflightError("Template source file in storage is empty.");
  }

  if (template.fileType === TemplateFileType.PDF) {
    let pdfDoc: PDFDocument;
    try {
      pdfDoc = await PDFDocument.load(templateBuffer, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch (pdfErr) {
      const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      throw new GenerationPreflightError(`Invalid or corrupt PDF template: ${msg}`);
    }

    if (pdfDoc.getPageCount() !== 1) {
      throw new GenerationPreflightError(
        `PDF template must be exactly 1 page (found ${pdfDoc.getPageCount()} pages).`
      );
    }

    try {
      validatePdfPageGeometry(pdfDoc.getPage(0));
    } catch (geomErr) {
      const msg = geomErr instanceof Error ? geomErr.message : String(geomErr);
      throw new GenerationPreflightError(`Unsupported PDF template geometry: ${msg}`);
    }
  } else if (
    template.fileType === TemplateFileType.PNG ||
    template.fileType === TemplateFileType.JPG
  ) {
    let metadata: Metadata;
    try {
      metadata = await sharp(templateBuffer).metadata();
    } catch (imageErr) {
      const msg = imageErr instanceof Error ? imageErr.message : String(imageErr);
      throw new GenerationPreflightError(`Invalid image template file: ${msg}`);
    }

    if (!metadata.width || !metadata.height) {
      throw new GenerationPreflightError("Image template has missing or invalid dimensions.");
    }

    if (metadata.orientation !== undefined && metadata.orientation !== 1) {
      throw new GenerationPreflightError(
        `Unsupported image orientation: EXIF orientation ${metadata.orientation} is not supported.`
      );
    }
  }

  // 7. Validate target active participants
  if (batch.participants.length === 0) {
    throw new GenerationPreflightError(
      "Cannot generate certificates for a batch with 0 participants. Import or add participants first."
    );
  }

  const validatedParticipants: Array<{
    id: string;
    name: string;
    normalizedName: string;
  }> = [];

  for (const participant of batch.participants) {
    const normalized = normalizeParticipantName(participant.name);
    if (!normalized || normalized.length === 0) {
      throw new GenerationPreflightError(
        `Participant "${participant.name}" has an invalid blank name after normalization.`
      );
    }
    validatedParticipants.push({
      id: participant.id,
      name: participant.name,
      normalizedName: normalized,
    });
  }

  return {
    batchId: batch.id,
    batchName: batch.name,
    templateId: template.id,
    templateUpdatedAt: template.updatedAt,
    templateFileType: template.fileType,
    templateSourceFilePath: template.sourceFilePath,
    namePlacement: validatedPlacement,
    fontConfig: validatedStyle,
    fontAssetPath: template.fontAssetPath,
    activeParticipants: validatedParticipants,
  };
}

/**
 * Executes comprehensive preflight validation for INITIAL bulk generation.
 * Strictly verifies batch status is DRAFT before running shared rendering prerequisites.
 */
export async function executeGenerationPreflight(
  batchId: string
): Promise<ValidatedPreflightSnapshot> {
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
    throw new GenerationPreflightError("Certificate batch not found or has been deleted.");
  }

  if (batch.status !== BatchStatus.DRAFT) {
    throw new GenerationPreflightError(
      `Batch is in "${batch.status}" status. Initial bulk generation can only be started for batches in DRAFT status.`
    );
  }

  return validateRenderingPrerequisites(batchId);
}
