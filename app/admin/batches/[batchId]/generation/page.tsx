import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getBatchGenerationManagementData } from "@/lib/generation/management";
import { BatchNotFoundError } from "@/lib/batches";
import { GenerationManagementClient } from "./generation-management-client";

export const metadata = {
  title: "Generation Management | AutoCertif Admin",
};

interface GenerationManagementPageProps {
  params: Promise<{ batchId: string }>;
}

export default async function GenerationManagementPage({
  params,
}: GenerationManagementPageProps) {
  await requireAdmin();
  const { batchId } = await params;

  let data;
  try {
    data = await getBatchGenerationManagementData(batchId);
  } catch (error) {
    if (error instanceof BatchNotFoundError) {
      notFound();
    }
    throw error;
  }

  return <GenerationManagementClient initialData={data} />;
}
