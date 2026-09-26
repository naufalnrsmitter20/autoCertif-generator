import { NextResponse } from "next/server";
import { getTemplatePreviewSignedUrl } from "@/lib/templates";
import { AdminAuthError } from "@/lib/auth/guard";
import { BatchNotFoundError } from "@/lib/batches";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const signedUrl = await getTemplatePreviewSignedUrl(batchId);

    return NextResponse.json({
      success: true,
      signedUrl,
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
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate template preview URL.",
      },
      { status: 500 }
    );
  }
}
