export type BatchRequestedPayload = {
  batchId: string;
  generationKey: string;
};

export type ParticipantRequestedPayload = {
  batchId: string;
  participantId: string;
  certificateId: string;
  generationKey: string;
};

export type AutoCertifEvents = {
  "autocertif/generation.batch.requested": {
    data: BatchRequestedPayload;
  };
  "autocertif/generation.participant.requested": {
    data: ParticipantRequestedPayload;
  };
};
