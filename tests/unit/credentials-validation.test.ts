import { describe, it, expect } from "vitest";
import { credentialsSchema } from "@/lib/auth";

describe("Credentials Validation Schema", () => {
  it("accepts valid email and password", () => {
    const input = {
      email: "Admin@AutoCertif.org",
      password: "ValidPassword123!",
    };

    const result = credentialsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("admin@autocertif.org");
      expect(result.data.password).toBe("ValidPassword123!");
    }
  });

  it("trims and lowercases email address", () => {
    const input = {
      email: "   User.Admin@Example.COM   ",
      password: "Password123456",
    };

    const result = credentialsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user.admin@example.com");
    }
  });

  it("rejects invalid email formats", () => {
    expect(
      credentialsSchema.safeParse({
        email: "not-an-email",
        password: "Password123456",
      }).success
    ).toBe(false);

    expect(
      credentialsSchema.safeParse({
        email: "@no-user.com",
        password: "Password123456",
      }).success
    ).toBe(false);

    expect(
      credentialsSchema.safeParse({
        email: "",
        password: "Password123456",
      }).success
    ).toBe(false);
  });

  it("rejects empty password", () => {
    expect(
      credentialsSchema.safeParse({
        email: "admin@example.com",
        password: "",
      }).success
    ).toBe(false);
  });
});
