import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/auth/guard";
import { BatchNotFoundError } from "@/lib/batches";
import { unpublishBatch } from "@/lib/publication/service";

interface RouteParams {
  params: Promise<{ batchId: string }>;
}

export async function POST(
  _request: Request,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { batchId } = await params;
    const result = await unpublishBatch(batchId);

    return NextResponse.json({
      success: true,
      message: "Batch successfully unpublished. Public visibility removed.",
      data: result,
    });
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
      { success: false, error: `Failed to unpublish batch: ${message}` },
      { status: 500 }
    );
  }
}
