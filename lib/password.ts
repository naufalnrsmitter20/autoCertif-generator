import bcrypt from "bcryptjs";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72;

export interface PasswordValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates password rules:
 * - Minimum 12 characters
 * - Maximum 72 bytes in UTF-8 (prevents silent bcrypt truncation)
 */
export function validatePassword(password: string): PasswordValidationResult {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }

  const byteLength = Buffer.byteLength(password, "utf8");
  if (byteLength > MAX_PASSWORD_BYTES) {
    return {
      valid: false,
      reason: `Password exceeds the maximum length of ${MAX_PASSWORD_BYTES} bytes.`,
    };
  }

  return { valid: true };
}

/**
 * Hashes a plain password using bcrypt with work factor 12.
 * Throws if the password violates validation rules.
 */
export async function hashPassword(password: string): Promise<string> {
  const validation = validatePassword(password);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  return bcrypt.hash(password, 12);
}

/**
 * Securely compares a plain password against an existing bcrypt hash.
 * If the input exceeds the 72-byte limit, rejects immediately without comparing
 * to prevent bcrypt truncation vulnerabilities.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }

  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return false;
  }

  return bcrypt.compare(password, hash);
}
