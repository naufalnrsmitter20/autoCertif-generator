export const TEMPLATE_STORAGE_BUCKET = "certificate-templates";

/**
 * Technical maximum file size limit for certificate templates: 10 MB.
 * Justification: Provides ample headroom for 300 DPI print-ready single-page
 * certificates while preventing Vercel function memory exhaustion during
 * server-side buffer validation (pdf-lib and sharp).
 */
export const MAX_TEMPLATE_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10,485,760 bytes

export const ALLOWED_TEMPLATE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;

export type AllowedTemplateMimeType = (typeof ALLOWED_TEMPLATE_MIME_TYPES)[number];

export const ALLOWED_TEMPLATE_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
] as const;

export const SIGNED_PREVIEW_URL_EXPIRY_SECONDS = 300; // 5 minutes
