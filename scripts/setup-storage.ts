import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  TEMPLATE_STORAGE_BUCKET,
  MAX_TEMPLATE_FILE_SIZE_BYTES,
  ALLOWED_TEMPLATE_MIME_TYPES,
  GENERATED_CERTIFICATES_BUCKET,
  MAX_GENERATED_CERTIFICATE_FILE_SIZE_BYTES,
  ALLOWED_GENERATED_CERTIFICATE_MIME_TYPES,
} from "../lib/storage/constants";

interface BucketConfig {
  name: string;
  public: boolean;
  fileSizeLimit: number;
  allowedMimeTypes: readonly string[];
}

const BUCKETS_TO_SETUP: BucketConfig[] = [
  {
    name: TEMPLATE_STORAGE_BUCKET,
    public: false,
    fileSizeLimit: MAX_TEMPLATE_FILE_SIZE_BYTES,
    allowedMimeTypes: ALLOWED_TEMPLATE_MIME_TYPES,
  },
  {
    name: GENERATED_CERTIFICATES_BUCKET,
    public: false,
    fileSizeLimit: MAX_GENERATED_CERTIFICATE_FILE_SIZE_BYTES,
    allowedMimeTypes: ALLOWED_GENERATED_CERTIFICATE_MIME_TYPES,
  },
];

async function setupStorage() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseSecret) {
    console.error("❌ Error: Missing Supabase credentials in environment.");
    console.error(
      "Required: SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)."
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error(`❌ Failed to list storage buckets: ${listError.message}`);
    process.exit(1);
  }

  for (const config of BUCKETS_TO_SETUP) {
    console.log(`\nChecking Supabase Storage bucket "${config.name}"...`);

    const existing = buckets?.find(
      (b) => b.name === config.name || b.id === config.name
    );

    if (!existing) {
      console.log(`Bucket "${config.name}" not found. Creating private bucket...`);
      const { error: createError } = await supabase.storage.createBucket(
        config.name,
        {
          public: config.public,
          fileSizeLimit: config.fileSizeLimit,
          allowedMimeTypes: [...config.allowedMimeTypes],
        }
      );

      if (createError) {
        console.error(`❌ Failed to create bucket "${config.name}": ${createError.message}`);
        process.exit(1);
      }

      console.log(`✅ Successfully created private bucket "${config.name}".`);
      console.log(`   - Public: ${config.public}`);
      console.log(`   - File size limit: ${config.fileSizeLimit} bytes`);
      console.log(`   - Allowed MIME types: ${config.allowedMimeTypes.join(", ")}`);
      continue;
    }

    console.log(`Bucket "${config.name}" exists. Verifying configuration...`);

    // Verify privacy
    if (existing.public !== config.public) {
      console.error(`❌ SECURITY MISMATCH: Bucket "${config.name}" is PUBLIC!`);
      console.error("Bucket must remain strictly PRIVATE. Halting without mutation.");
      process.exit(1);
    }

    // Verify file size limit
    if (
      existing.file_size_limit !== null &&
      existing.file_size_limit !== undefined &&
      existing.file_size_limit !== config.fileSizeLimit
    ) {
      console.warn(
        `⚠️ Note: Existing bucket file size limit (${existing.file_size_limit}) differs from configured maximum (${config.fileSizeLimit}).`
      );
    }

    // Verify MIME types
    if (existing.allowed_mime_types && existing.allowed_mime_types.length > 0) {
      const missing = config.allowedMimeTypes.filter(
        (mime) => !existing.allowed_mime_types?.includes(mime)
      );

      if (missing.length > 0) {
        console.error(
          `❌ CONFIGURATION MISMATCH: Bucket allowed MIME types do not cover required: ${missing.join(", ")}`
        );
        process.exit(1);
      }
    }

    console.log(`✅ Bucket "${config.name}" verified:`);
    console.log(`   - Public: false (PRIVATE verified)`);
    console.log(`   - Allowed MIME types cover required formats`);
  }
}

setupStorage().catch((err) => {
  console.error("Unexpected error during storage setup:", err);
  process.exit(1);
});
