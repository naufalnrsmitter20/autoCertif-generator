import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  TEMPLATE_STORAGE_BUCKET,
  MAX_TEMPLATE_FILE_SIZE_BYTES,
  ALLOWED_TEMPLATE_MIME_TYPES,
} from "../lib/storage/constants";

async function setupStorage() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseSecret) {
    console.error("❌ Error: Missing Supabase credentials in environment.");
    console.error("Required: SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log(`Checking Supabase Storage bucket "${TEMPLATE_STORAGE_BUCKET}"...`);

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error(`❌ Failed to list storage buckets: ${listError.message}`);
    process.exit(1);
  }

  const existing = buckets?.find((b) => b.name === TEMPLATE_STORAGE_BUCKET || b.id === TEMPLATE_STORAGE_BUCKET);

  if (!existing) {
    console.log(`Bucket "${TEMPLATE_STORAGE_BUCKET}" not found. Creating private bucket...`);
    const { error: createError } = await supabase.storage.createBucket(
      TEMPLATE_STORAGE_BUCKET,
      {
        public: false,
        fileSizeLimit: MAX_TEMPLATE_FILE_SIZE_BYTES,
        allowedMimeTypes: [...ALLOWED_TEMPLATE_MIME_TYPES],
      }
    );

    if (createError) {
      console.error(`❌ Failed to create bucket: ${createError.message}`);
      process.exit(1);
    }

    console.log(`✅ Successfully created private bucket "${TEMPLATE_STORAGE_BUCKET}".`);
    console.log(`   - Public: false`);
    console.log(`   - File size limit: ${MAX_TEMPLATE_FILE_SIZE_BYTES} bytes (10 MB)`);
    console.log(`   - Allowed MIME types: ${ALLOWED_TEMPLATE_MIME_TYPES.join(", ")}`);
    return;
  }

  console.log(`Bucket "${TEMPLATE_STORAGE_BUCKET}" exists. Verifying configuration...`);

  // Verify privacy
  if (existing.public) {
    console.error(`❌ SECURITY MISMATCH: Bucket "${TEMPLATE_STORAGE_BUCKET}" is PUBLIC!`);
    console.error("Certificate templates must remain strictly PRIVATE. Halting without mutation.");
    process.exit(1);
  }

  // Verify file size limit
  if (
    existing.file_size_limit !== null &&
    existing.file_size_limit !== undefined &&
    existing.file_size_limit !== MAX_TEMPLATE_FILE_SIZE_BYTES
  ) {
    console.warn(
      `⚠️ Note: Existing bucket file size limit (${existing.file_size_limit}) differs from configured maximum (${MAX_TEMPLATE_FILE_SIZE_BYTES}).`
    );
  }

  // Verify MIME types
  if (existing.allowed_mime_types && existing.allowed_mime_types.length > 0) {
    const hasPdf = existing.allowed_mime_types.includes("application/pdf");
    const hasPng = existing.allowed_mime_types.includes("image/png");
    const hasJpeg =
      existing.allowed_mime_types.includes("image/jpeg") ||
      existing.allowed_mime_types.includes("image/jpg");

    if (!hasPdf || !hasPng || !hasJpeg) {
      console.error(
        `❌ CONFIGURATION MISMATCH: Bucket allowed MIME types (${existing.allowed_mime_types.join(
          ", "
        )}) do not cover all required types (PDF, PNG, JPEG).`
      );
      process.exit(1);
    }
  }

  console.log(`✅ Bucket "${TEMPLATE_STORAGE_BUCKET}" verified:`);
  console.log(`   - Public: false (PRIVATE verified)`);
  console.log(`   - Allowed MIME types cover required formats`);
}

setupStorage().catch((err) => {
  console.error("Unexpected error during storage setup:", err);
  process.exit(1);
});
