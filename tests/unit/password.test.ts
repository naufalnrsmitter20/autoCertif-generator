import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
} from "@/lib/password";

describe("Password Hashing & Validation", { timeout: 20000 }, () => {
  it("enforces minimum password length of 12 characters", () => {
    expect(validatePassword("short").valid).toBe(false);
    expect(validatePassword("12345678901").valid).toBe(false); // 11 chars
    expect(validatePassword("123456789012").valid).toBe(true); // 12 chars
  });

  it("enforces maximum UTF-8 byte length of 72 bytes to prevent silent truncation", () => {
    const valid72Bytes = "a".repeat(72);
    expect(validatePassword(valid72Bytes).valid).toBe(true);

    const invalid73Bytes = "a".repeat(73);
    const result = validatePassword(invalid73Bytes);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("exceeds the maximum length of 72 bytes");

    // Multi-byte UTF-8 test (each emoji is 4 bytes: 19 * 4 = 76 bytes)
    const multiByteString = "🚀".repeat(19);
    expect(Buffer.byteLength(multiByteString, "utf8")).toBe(76);
    expect(validatePassword(multiByteString).valid).toBe(false);
  });

  it("successfully hashes and verifies matching password", async () => {
    const password = "SuperSecretPassword123!";
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true);

    const isMatch = await verifyPassword(password, hash);
    expect(isMatch).toBe(true);
  });

  it("fails verification for incorrect password", async () => {
    const password = "SuperSecretPassword123!";
    const hash = await hashPassword(password);

    const isMatch = await verifyPassword("WrongPassword123!", hash);
    expect(isMatch).toBe(false);
  });

  it("produces distinct salts for identical passwords", async () => {
    const password = "IdenticalPassword123!";
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it("rejects verification immediately for passwords exceeding 72 bytes", async () => {
    // Standard bcrypt would truncate at 72 bytes and match the first 72 bytes.
    // Our verifyPassword must return false to prevent this vulnerability.
    const prefix = "a".repeat(72);
    const hash = await hashPassword(prefix);

    const truncatedMatchAttempt = prefix + "ExtraCharactersAfter72Bytes";
    const isMatch = await verifyPassword(truncatedMatchAttempt, hash);
    expect(isMatch).toBe(false);
  });
});
