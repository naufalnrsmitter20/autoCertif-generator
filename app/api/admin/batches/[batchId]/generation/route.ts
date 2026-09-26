import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/auth/guard";
import { inngest } from "@/lib/inngest/client";
import { initializeGeneration, getRecoverableDispatchKey } from "@/lib/generation/initialize";
import {
  GenerationPreflightError,
  ConcurrentGenerationConflictError,
  BatchNotEligibleForGenerationError,
} from "@/lib/generation/errors";

interface RouteParams {
  params: Promise<{ batchId: string }>;
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

    if (
      error instanceof GenerationPreflightError ||
      (error instanceof Error && error.name === "GenerationPreflightError") ||
      error instanceof ConcurrentGenerationConflictError ||
      (error instanceof Error && error.name === "ConcurrentGenerationConflictError") ||
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
      { success: false, error: `Failed to initiate generation: ${message}` },
      { status: 500 }
    );
  }
}
