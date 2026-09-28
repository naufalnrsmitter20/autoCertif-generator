import { NextResponse } from "next/server";
import { z } from "zod";
import {
  updateTemplatePlacement,
  TemplateEligibilityError,
  StaleTemplateConflictError,
} from "@/lib/templates";
import { AdminAuthError } from "@/lib/auth/guard";
import { BatchNotFoundError } from "@/lib/batches";
import { namePlacementSchema } from "@/lib/coordinates";
import { FontNotConfiguredError } from "@/lib/rendering/errors";

const savePlacementRequestSchema = z.object({
  templateId: z.string().trim().min(1, "Template ID is required"),
  placement: namePlacementSchema,
  typography: z.object({
    fontFamily: z.literal("DM Sans"),
    fontAssetPath: z.string().min(1),
    fontSize: z.number().positive().max(500),
  }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const body = await request.json();

    const validated = savePlacementRequestSchema.parse(body);

    const result = await updateTemplatePlacement(batchId, {
      templateId: validated.templateId,
      placement: validated.placement,
      typography: validated.typography,
    });

    return NextResponse.json({
      success: true,
      templateId: result.templateId,
      placement: result.namePlacement,
    });
  } catch (error: unknown) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: ADMIN login required." },
        { status: 401 }
      );
    }

    if (error instanceof BatchNotFoundError) {
      return NextResponse.json(
        { success: false, error: "Certificate batch not found." },
        { status: 404 }
      );
    }

    if (error instanceof TemplateEligibilityError || error instanceof FontNotConfiguredError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    if (error instanceof StaleTemplateConflictError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: "STALE_TEMPLATE",
        },
        { status: 409 }
      );
    }

    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return NextResponse.json(
        {
          success: false,
          error: issue?.message || "Invalid name placement data.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while saving name placement.",
      },
      { status: 500 }
    );
  }
}
