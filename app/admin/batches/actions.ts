"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createBatch,
  updateBatchName,
  softDeleteBatch,
  BatchNotFoundError,
} from "@/lib/batches";
import { AdminAuthError } from "@/lib/auth/guard";
import { batchInputSchema } from "@/lib/validations/batch";

export type ActionState = {
  success?: boolean;
  error?: string;
  fieldErrors?: {
    name?: string[];
  };
};

export async function createBatchAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  let targetUrl: string | null = null;

  try {
    const rawName = formData.get("name");
    const parsed = batchInputSchema.safeParse({ name: rawName });

    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      return {
        success: false,
        error: "Please enter a valid batch name.",
        fieldErrors: {
          name: flattened.fieldErrors.name,
        },
      };
    }

    const batch = await createBatch({ name: parsed.data.name });
    revalidatePath("/admin/batches");
    targetUrl = `/admin/batches/${batch.id}`;
  } catch (error) {
    if (error instanceof AdminAuthError) {
      targetUrl = "/login";
    } else {
      return {
        success: false,
        error: "An unexpected error occurred while creating the batch.",
      };
    }
  }

  if (targetUrl) {
    redirect(targetUrl);
  }

  return { success: true };
}

export async function updateBatchNameAction(
  batchId: string,
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  let redirectToLogin = false;

  try {
    const rawName = formData.get("name");
    const parsed = batchInputSchema.safeParse({ name: rawName });

    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      return {
        success: false,
        error: "Please enter a valid batch name.",
        fieldErrors: {
          name: flattened.fieldErrors.name,
        },
      };
    }

    await updateBatchName(batchId, { name: parsed.data.name });
    revalidatePath("/admin/batches");
    revalidatePath(`/admin/batches/${batchId}`);

    return {
      success: true,
    };
  } catch (error) {
    if (error instanceof AdminAuthError) {
      redirectToLogin = true;
    } else if (error instanceof BatchNotFoundError) {
      return {
        success: false,
        error: "Batch not found or already deleted.",
      };
    } else {
      return {
        success: false,
        error: "An unexpected error occurred while updating the batch.",
      };
    }
  }

  if (redirectToLogin) {
    redirect("/login");
  }

  return { success: true };
}

export async function deleteBatchAction(batchId: string): Promise<void> {
  let targetUrl = "/admin/batches";

  try {
    await softDeleteBatch(batchId);
    revalidatePath("/admin/batches");
  } catch (error) {
    if (error instanceof AdminAuthError) {
      targetUrl = "/login";
    } else if (error instanceof BatchNotFoundError) {
      targetUrl = "/admin/batches";
    } else {
      throw new Error("Failed to delete certificate batch.");
    }
  }

  redirect(targetUrl);
}
