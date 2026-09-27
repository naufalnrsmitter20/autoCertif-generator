import type { CertificateStatus, BatchStatus } from "@/generated/prisma/enums";

export interface ManagementCertificateRow {
  participantId: string;
  name: string;
  certificateId: string | null;
  certificateStatus: CertificateStatus | "UNINITIALIZED";
  safeGenerationError: string | null;
  generatedAt: string | null;
  hasPreviousOutput: boolean;
  isStale: boolean;
  publishedName: string | null;
  publishedFilePath: string | null;
}

export interface BatchGenerationManagementData {
  batch: {
    id: string;
    name: string;
    status: BatchStatus;
    currentGenerationKey: string | null;
    publishedAt: string | null;
    updatedAt: string;
  };
  summary: {
    total: number;
    pending: number;
    generating: number;
    generated: number;
    failed: number;
    stale: number;
  };
  participants: ManagementCertificateRow[];
}
