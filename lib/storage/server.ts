import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  TEMPLATE_STORAGE_BUCKET,
  GENERATED_CERTIFICATES_BUCKET,
  SIGNED_PREVIEW_URL_EXPIRY_SECONDS,
} from "./constants";

export class StorageConfigurationError extends Error {
  constructor(message = "Supabase Storage credentials are not configured in the environment.") {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

export class StorageOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageOperationError";
  }
}

let serverClientInstance: SupabaseClient | null = null;

/**
 * Returns a server-only Supabase client with administrative storage access.
 * NEVER expose this client or its credentials to browser bundles.
 */
export function getServerStorageClient(): SupabaseClient {
  if (serverClientInstance) {
    return serverClientInstance;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseSecret) {
    throw new StorageConfigurationError();
  }

  serverClientInstance = createClient(supabaseUrl, supabaseSecret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return serverClientInstance;
}

/**
 * Creates a signed upload URL and token for a specific deterministic storage path.
 * Enforces non-overwrite behavior via { upsert: false } at token creation.
 */
export async function createTemplateSignedUploadUrl(
  objectPath: string
): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = getServerStorageClient();

  const { data, error } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .createSignedUploadUrl(objectPath, { upsert: false });

  if (error || !data) {
    throw new StorageOperationError(
      `Failed to create signed upload URL: ${error?.message || "Unknown error"}`
    );
  }

  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
  };
}

/**
 * Downloads candidate file bytes using server credentials.
 */
export async function downloadTemplateBuffer(objectPath: string): Promise<Buffer> {
  const supabase = getServerStorageClient();

  const { data, error } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .download(objectPath);

  if (error || !data) {
    throw new StorageOperationError(
      `Failed to download uploaded object from storage: ${error?.message || "Object not found"}`
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Deletes an object from the template storage bucket (used for compensating cleanup).
 */
export async function deleteTemplateObject(objectPath: string): Promise<void> {
  const supabase = getServerStorageClient();

  const { error } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .remove([objectPath]);

  if (error) {
    throw new StorageOperationError(
      `Failed to delete candidate object from storage: ${error.message}`
    );
  }
}

/**
 * Generates a short-lived signed read URL for private ADMIN preview.
 * URL expires after the configured duration (default: 5 minutes).
 */
export async function createTemplateSignedReadUrl(
  objectPath: string,
  expiresInSeconds = SIGNED_PREVIEW_URL_EXPIRY_SECONDS
): Promise<string> {
  const supabase = getServerStorageClient();

  const { data, error } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new StorageOperationError(
      `Failed to create signed preview URL: ${error?.message || "Unknown error"}`
    );
  }

  return data.signedUrl;
}

/**
 * Uploads a generated certificate PDF to private storage with retry-safe upsert.
 * Uses upsert: true so that Inngest retries within the same attempt can safely
 * overwrite the same deterministic object path.
 */
export async function uploadGeneratedCertificate(
  objectPath: string,
  pdfBytes: Uint8Array
): Promise<void> {
  const supabase = getServerStorageClient();

  const { error } = await supabase.storage
    .from(GENERATED_CERTIFICATES_BUCKET)
    .upload(objectPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new StorageOperationError(
      `Failed to upload generated certificate to storage: ${error.message}`
    );
  }
}

/**
 * Generates a short-lived signed read URL for a generated certificate in private storage.
 * URL expires after the configured duration (default: 5 minutes / 300 seconds).
 * When downloadFilename is provided, Supabase Storage sets the Content-Disposition
 * attachment header with the specified filename.
 */
export async function createCertificateSignedReadUrl(
  objectPath: string,
  expiresInSeconds = SIGNED_PREVIEW_URL_EXPIRY_SECONDS,
  downloadFilename?: string
): Promise<string> {
  const supabase = getServerStorageClient();

  const options = downloadFilename ? { download: downloadFilename } : undefined;

  const { data, error } = await supabase.storage
    .from(GENERATED_CERTIFICATES_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds, options);

  if (error || !data?.signedUrl) {
    throw new StorageOperationError(
      `Failed to create certificate signed URL: ${error?.message || "Unknown error"}`
    );
  }

  return data.signedUrl;
}

