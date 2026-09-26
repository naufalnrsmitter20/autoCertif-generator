import { NextResponse } from "next/server";
import { initiateTemplateUpload, TemplateEligibilityError } from "@/lib/templates";
import { preliminaryUploadInputSchema, TemplateValidationError } from "@/lib/validations/template-file";
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
    const validatedInput = preliminaryUploadInputSchema.parse(body);

    const result = await initiateTemplateUpload(batchId, validatedInput);
    return NextResponse.json({ success: true, ...result });
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
        error: error instanceof Error ? error.message : "Failed to initiate template upload.",
      },
      { status: 500 }
    );
  }
}
