/**
 * Typed domain errors for publication and safe published replacement operations.
 */

export class PublicationDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationDomainError";
  }
}

export class BatchNotEligibleForPublicationError extends PublicationDomainError {
  constructor(message = "Batch is not eligible for publication.") {
    super(message);
    this.name = "BatchNotEligibleForPublicationError";
  }
}

export class BatchNotPublishedError extends PublicationDomainError {
  constructor(message = "Batch is not currently published.") {
    super(message);
    this.name = "BatchNotPublishedError";
  }
}

export class ConcurrentPublicationConflictError extends PublicationDomainError {
  constructor(
    message = "Batch publication state changed concurrently or generation identity is stale."
  ) {
    super(message);
    this.name = "ConcurrentPublicationConflictError";
  }
}

export class ZeroEligibleCertificatesError extends PublicationDomainError {
  constructor(
    message = "Batch has zero successfully generated eligible certificates to publish."
  ) {
    super(message);
    this.name = "ZeroEligibleCertificatesError";
  }
}

export class InvalidParticipantNameError extends PublicationDomainError {
  constructor(message = "Participant name is invalid or unchanged.") {
    super(message);
    this.name = "InvalidParticipantNameError";
  }
}

export class PublishedParticipantMismatchError extends PublicationDomainError {
  constructor(message = "Participant does not belong to the published batch or has no active certificate.") {
    super(message);
    this.name = "PublishedParticipantMismatchError";
  }
}
