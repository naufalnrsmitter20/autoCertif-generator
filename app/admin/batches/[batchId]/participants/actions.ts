"use server";

import { revalidatePath } from "next/cache";
import {
  importParticipants,
  addParticipant,
  editParticipant,
  softDeleteParticipant,
  BatchNotFoundError,
  BatchNotDraftError,
  ParticipantNotFoundError,
  UnexpectedCertificateStateError,
} from "@/lib/participants/service";
import { AdminAuthError } from "@/lib/auth/guard";

export type ParticipantActionState = {
  success?: boolean;
  error?: string;
  fieldErrors?: {
    name?: string[];
  };
};

// ─── Import ───────────────────────────────────────────────────────────────────

export async function importParticipantsAction(
  batchId: string,
  names: string[]
): Promise<ParticipantActionState> {
  try {
    const result = await importParticipants(batchId, names);
    revalidatePath(`/admin/batches/${batchId}/participants`);
    return { success: true, error: `${result.count} participant(s) imported.` };
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return { success: false, error: "Unauthorized. Please log in again." };
    }
    if (error instanceof BatchNotFoundError) {
      return { success: false, error: "Batch not found or already deleted." };
    }
    if (error instanceof BatchNotDraftError) {
      return {
        success: false,
        error: "Participants can only be imported into DRAFT batches.",
      };
    }
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred." };
  }
}

// ─── Add ──────────────────────────────────────────────────────────────────────

export async function addParticipantAction(
  batchId: string,
  prevState: ParticipantActionState,
  formData: FormData
): Promise<ParticipantActionState> {
  try {
    const rawName = formData.get("name");
    await addParticipant(batchId, rawName);
    revalidatePath(`/admin/batches/${batchId}/participants`);
    return { success: true };
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return { success: false, error: "Unauthorized. Please log in again." };
    }
    if (error instanceof BatchNotFoundError) {
      return { success: false, error: "Batch not found or already deleted." };
    }
    if (error instanceof BatchNotDraftError) {
      return {
        success: false,
        error: "Participants can only be added to DRAFT batches.",
      };
    }
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
        fieldErrors: { name: [error.message] },
      };
    }
    return { success: false, error: "An unexpected error occurred." };
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

export async function editParticipantAction(
  batchId: string,
  participantId: string,
  prevState: ParticipantActionState,
  formData: FormData
): Promise<ParticipantActionState> {
  try {
    const rawName = formData.get("name");
    await editParticipant(batchId, participantId, rawName);
    revalidatePath(`/admin/batches/${batchId}/participants`);
    return { success: true };
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return { success: false, error: "Unauthorized. Please log in again." };
    }
    if (error instanceof BatchNotFoundError) {
      return { success: false, error: "Batch not found or already deleted." };
    }
    if (error instanceof BatchNotDraftError) {
      return {
        success: false,
        error: "Participants can only be edited in DRAFT batches.",
      };
    }
    if (error instanceof ParticipantNotFoundError) {
      return {
        success: false,
        error: "Participant not found or already deleted.",
      };
    }
    if (error instanceof UnexpectedCertificateStateError) {
      return {
        success: false,
        error:
          "This participant has an existing certificate. Editing requires the Phase 11 safe-update workflow.",
      };
    }
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
        fieldErrors: { name: [error.message] },
      };
    }
    return { success: false, error: "An unexpected error occurred." };
  }
}

// ─── Soft Delete ──────────────────────────────────────────────────────────────

export async function deleteParticipantAction(
  batchId: string,
  participantId: string
): Promise<ParticipantActionState> {
  try {
    await softDeleteParticipant(batchId, participantId);
    revalidatePath(`/admin/batches/${batchId}/participants`);
    return { success: true };
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return { success: false, error: "Unauthorized. Please log in again." };
    }
    if (error instanceof BatchNotFoundError) {
      return { success: false, error: "Batch not found or already deleted." };
    }
    if (error instanceof BatchNotDraftError) {
      return {
        success: false,
        error: "Participants can only be deleted from DRAFT batches.",
      };
    }
    if (error instanceof ParticipantNotFoundError) {
      return {
        success: false,
        error: "Participant not found or already deleted.",
      };
    }
    if (error instanceof UnexpectedCertificateStateError) {
      return {
        success: false,
        error:
          "This participant has an existing certificate. Deletion requires the Phase 11 safe-update workflow.",
      };
    }
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred." };
  }
}
