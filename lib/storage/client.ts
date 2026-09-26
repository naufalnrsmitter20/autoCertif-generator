import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { TEMPLATE_STORAGE_BUCKET } from "./constants";

let browserClientInstance: SupabaseClient | null = null;

export function getBrowserStorageClient(): SupabaseClient {
  if (browserClientInstance) {
    return browserClientInstance;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error(
      "Supabase browser credentials (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) are not configured."
    );
  }

  browserClientInstance = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return browserClientInstance;
}

/**
 * Uploads a file directly from the browser to Supabase Storage using a pre-authorized signed URL token.
 * Note: Non-overwrite behavior was already enforced at token creation via { upsert: false }.
 */
export async function uploadCandidateToSignedUrl(
  path: string,
  token: string,
  file: File
): Promise<{ fullPath: string; path: string }> {
  const supabase = getBrowserStorageClient();

  const { data, error } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .uploadToSignedUrl(path, token, file);

  if (error || !data) {
    throw new Error(`Direct storage upload failed: ${error?.message || "Unknown error"}`);
  }

  return {
    fullPath: data.fullPath,
    path: data.path,
  };
}
