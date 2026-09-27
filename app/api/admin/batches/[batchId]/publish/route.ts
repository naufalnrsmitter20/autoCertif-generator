import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/auth/guard";
import { BatchNotFoundError } from "@/lib/batches";
import {
  getPublishPreflight,
  publishBatch,
} from "@/lib/publication/service";
import {
  ConcurrentPublicationConflictError,
  ZeroEligibleCertificatesError,
  BatchNotEligibleForPublicationError,
} from "@/lib/publication/errors";

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
    const preflight = await getPublishPreflight(batchId);
    return NextResponse.json({
      success: true,
      data: preflight,
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
    if (
      error instanceof BatchNotEligibleForPublicationError ||
      (error instanceof Error && error.name === "BatchNotEligibleForPublicationError")
    ) {
      return NextResponse.json(
        { success: false, error: (error as Error).message },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Unexpected error occurred";
    return NextResponse.json(
      { success: false, error: `Failed to fetch publish preflight: ${message}` },
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
    const expectedCurrentGenerationKey =
      typeof body.expectedCurrentGenerationKey === "string"
        ? body.expectedCurrentGenerationKey
        : null;

    const result = await publishBatch(batchId, expectedCurrentGenerationKey);

    return NextResponse.json({
      success: true,
      message: `Batch successfully published with ${result.publishedCount} certificate${
        result.publishedCount === 1 ? "" : "s"
      }.`,
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
    if (
      error instanceof ConcurrentPublicationConflictError ||
      (error instanceof Error && error.name === "ConcurrentPublicationConflictError")
    ) {
      return NextResponse.json(
        { success: false, error: (error as Error).message },
        { status: 409 }
      );
    }
    if (
      error instanceof ZeroEligibleCertificatesError ||
      error instanceof BatchNotEligibleForPublicationError ||
      (error instanceof Error &&
        (error.name === "ZeroEligibleCertificatesError" ||
          error.name === "BatchNotEligibleForPublicationError"))
    ) {
      return NextResponse.json(
        { success: false, error: (error as Error).message },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Unexpected error occurred";
    return NextResponse.json(
      { success: false, error: `Failed to publish batch: ${message}` },
      { status: 500 }
    );
  }
}
