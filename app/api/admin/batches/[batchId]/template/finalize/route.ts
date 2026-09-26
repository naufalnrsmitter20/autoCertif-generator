import { NextResponse } from "next/server";
import {
  finalizeTemplateUpload,
  TemplateEligibilityError,
  ConcurrentModificationError,
} from "@/lib/templates";
import { finalizeTemplateInputSchema, TemplateValidationError } from "@/lib/validations/template-file";
import { AdminAuthError } from "@/lib/auth/guard";
import { BatchNotFoundError } from "@/lib/batches";
import { StorageConfigurationError } from "@/lib/storage/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const body = await request.json();
    const validatedInput = finalizeTemplateInputSchema.parse(body);

    const template = await finalizeTemplateUpload(batchId, validatedInput);

    return NextResponse.json({
      success: true,
      template: {
        id: template.id,
        name: template.name,
        fileType: template.fileType,
        pageWidth: template.pageWidth,
        pageHeight: template.pageHeight,
      },
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
        { success: false, error: "Certificate batch not found or already deleted." },
        { status: 404 }
      );
    }
    if (error instanceof TemplateEligibilityError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof ConcurrentModificationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    if (error instanceof TemplateValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof StorageConfigurationError) {
      return NextResponse.json(
        { success: false, error: "Storage service is not configured in this environment." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during template finalization.",
      },
      { status: 500 }
    );
  }
}
