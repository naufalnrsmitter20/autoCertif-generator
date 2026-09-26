import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getActiveBatchById } from "@/lib/batches";
import { getTemplatePreviewSignedUrl } from "@/lib/templates";
import { PositionEditorClient } from "./position-editor-client";

export const metadata = {
  title: "Name Position Editor | AutoCertif Admin",
};

interface PositionPageProps {
  params: Promise<{ batchId: string }>;
}

export default async function PositionPage({ params }: PositionPageProps) {
  await requireAdmin();
  const { batchId } = await params;

  const batch = await getActiveBatchById(batchId);
  if (!batch) {
    notFound();
  }

  if (!batch.template) {
    redirect(`/admin/batches/${batchId}`);
  }

  let previewUrl = "";
  try {
    previewUrl = await getTemplatePreviewSignedUrl(batchId);
  } catch (error) {
    console.error("Failed to generate template preview URL:", error);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/batches/${batchId}`}
            className="inline-flex items-center text-sm font-medium text-zinc-600 hover:text-zinc-900 rounded px-1 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          >
            &larr; Back to Batch
          </Link>
          <span className="text-zinc-300">/</span>
          <span className="text-sm font-semibold text-zinc-900 truncate max-w-xs sm:max-w-md">
            {batch.name}
          </span>
        </div>
      </div>

      <PositionEditorClient
        batchId={batch.id}
        batchName={batch.name}
        batchStatus={batch.status}
        template={{
          id: batch.template.id,
          name: batch.template.name,
          fileType: batch.template.fileType,
          pageWidth: batch.template.pageWidth,
          pageHeight: batch.template.pageHeight,
          namePlacement: batch.template.namePlacement,
        }}
        previewUrl={previewUrl}
      />
    </div>
  );
}
