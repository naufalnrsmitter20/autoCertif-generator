export interface PublishPreflightData {
  batchId: string;
  batchName: string;
  totalParticipants: number;
  eligibleCount: number;
  failedCount: number;
  failedParticipantNames: string[];
  canPublish: boolean;
  currentGenerationKey: string | null;
}

export interface PublishBatchResult {
  batchId: string;
  publishedAt: string;
  publishedCount: number;
  ineligibleCount: number;
}

export interface UnpublishBatchResult {
  batchId: string;
  unpublished: boolean;
}

export interface PublishedParticipantEditResult {
  batchId: string;
  participantId: string;
  generationKey: string;
  newName: string;
  previousPublishedName: string | null;
}
