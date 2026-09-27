import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/auth/guard";
import { inngest } from "@/lib/inngest/client";
import { initializeGeneration, getRecoverableDispatchKey } from "@/lib/generation/initialize";
import {
  getBatchGenerationManagementData,
  retryParticipantGeneration,
  regenerateParticipantGeneration,
  regenerateBatchGeneration,
  recoverFailedBatchGeneration,
} from "@/lib/generation/management";
import {
  GenerationPreflightError,
  ConcurrentGenerationConflictError,
  BatchNotEligibleForGenerationError,
} from "@/lib/generation/errors";
import { BatchNotFoundError } from "@/lib/batches";

interface RouteParams {
  params: Promise<{ batchId: string }>;
}

export async function GET(
  _request: Request,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { batchId } = await params;
    const data = await getBatchGenerationManagementData(batchId);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: ADMIN login required." },
        { status: 401 }
      );
    }
    if (error instanceof BatchNotFoundError) {
      return NextResponse.json(
        { success: false, error: "Certificate batch not found or already deleted." },
        { status: 404 }
      );
    }
    const message = error instanceof Error ? error.message : "Unexpected error occurred";
    return NextResponse.json(
      { success: false, error: `Failed to fetch generation data: ${message}` },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { batchId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body.action || "trigger";
    const expectedCurrentGenerationKey =
      typeof body.expectedCurrentGenerationKey === "string"
        ? body.expectedCurrentGenerationKey
        : null;

    if (action === "trigger") {
      const result = await initializeGeneration(batchId);

      await inngest.send({
        name: "autocertif/generation.batch.requested",
        id: `gen-batch-${batchId}-${result.generationKey}`,
        data: {
          batchId,
          generationKey: result.generationKey,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Generation started for ${result.participantCount} participant${
          result.participantCount === 1 ? "" : "s"
        }.`,
        generationKey: result.generationKey,
        participantCount: result.participantCount,
      });
    }

    if (action === "resume") {
      const recoverable = await getRecoverableDispatchKey(batchId);

      if (!recoverable.canResume || !recoverable.generationKey) {
        return NextResponse.json(
          {
            success: false,
            error: recoverable.reason || "Batch is not eligible for generation recovery.",
          },
          { status: 400 }
        );
      }

      await inngest.send({
        name: "autocertif/generation.batch.requested",
        id: `gen-batch-${batchId}-${recoverable.generationKey}`,
        data: {
          batchId,
          generationKey: recoverable.generationKey,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Generation dispatch re-enqueued successfully.",
        generationKey: recoverable.generationKey,
      });
    }

    if (action === "retry-participant") {
      const participantId = body.participantId;
      if (!participantId || typeof participantId !== "string") {
        return NextResponse.json(
          { success: false, error: "participantId is required for retry-participant." },
          { status: 400 }
        );
      }

      const result = await retryParticipantGeneration(
        batchId,
        participantId,
        expectedCurrentGenerationKey
      );

      return NextResponse.json({
        success: true,
        message: "Participant certificate retry started.",
        generationKey: result.generationKey,
        certificateId: result.certificateId,
      });
    }

    if (action === "regenerate-participant") {
      const participantId = body.participantId;
      if (!participantId || typeof participantId !== "string") {
        return NextResponse.json(
          { success: false, error: "participantId is required for regenerate-participant." },
          { status: 400 }
        );
      }

      const result = await regenerateParticipantGeneration(
        batchId,
        participantId,
        expectedCurrentGenerationKey
      );

      return NextResponse.json({
        success: true,
        message: "Participant certificate regeneration started.",
        generationKey: result.generationKey,
        certificateId: result.certificateId,
      });
    }

    if (action === "regenerate-batch") {
      const result = await regenerateBatchGeneration(
        batchId,
        expectedCurrentGenerationKey
      );

      return NextResponse.json({
        success: true,
        message: `Batch regeneration started for ${result.participantCount} participant${
          result.participantCount === 1 ? "" : "s"
        }.`,
        generationKey: result.generationKey,
        participantCount: result.participantCount,
      });
    }

    if (action === "recover-batch") {
      const result = await recoverFailedBatchGeneration(
        batchId,
        expectedCurrentGenerationKey
      );

      if (result.reconciled) {
        return NextResponse.json({
          success: true,
          reconciled: true,
          message: "Batch status successfully reconciled to Completed.",
        });
      }

      return NextResponse.json({
        success: true,
        reconciled: false,
        message: `Recovery started for ${result.recoveredCount} unfinished certificate${
          result.recoveredCount === 1 ? "" : "s"
        }.`,
        generationKey: result.generationKey,
        recoveredCount: result.recoveredCount,
      });
    }

    return NextResponse.json(
      { success: false, error: `Invalid action "${action}".` },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: ADMIN login required." },
        { status: 401 }
      );
    }

    if (error instanceof BatchNotFoundError) {
      return NextResponse.json(
        { success: false, error: (error as Error).message },
        { status: 404 }
      );
    }

    if (
      error instanceof ConcurrentGenerationConflictError ||
      (error instanceof Error && error.name === "ConcurrentGenerationConflictError")
    ) {
      return NextResponse.json(
        { success: false, error: (error as Error).message },
        { status: 409 }
      );
    }

    if (
      error instanceof GenerationPreflightError ||
      (error instanceof Error && error.name === "GenerationPreflightError") ||
      error instanceof BatchNotEligibleForGenerationError ||
      (error instanceof Error && error.name === "BatchNotEligibleForGenerationError")
    ) {
      return NextResponse.json(
        { success: false, error: (error as Error).message },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Unexpected error occurred";
    return NextResponse.json(
      { success: false, error: `Failed to process generation action: ${message}` },
      { status: 500 }
    );
  }
}
