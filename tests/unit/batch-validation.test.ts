import { describe, it, expect } from "vitest";
import { batchInputSchema, batchNameSchema } from "@/lib/validations/batch";

describe("Batch Validation Schema", () => {
  it("accepts a valid batch name and trims surrounding whitespace", () => {
    const result = batchInputSchema.safeParse({
      name: "  Batch Spring 2026  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Batch Spring 2026");
    }
  });

  it("rejects an empty batch name", () => {
    const result = batchInputSchema.safeParse({
      name: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.flatten().fieldErrors;
      expect(issues.name?.[0]).toBe("Batch name is required");
    }
  });

  it("rejects whitespace-only batch name", () => {
    const result = batchInputSchema.safeParse({
      name: "    ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.flatten().fieldErrors;
      expect(issues.name?.[0]).toBe("Batch name is required");
    }
  });

  it("accepts a batch name of exactly 150 characters", () => {
    const exactName = "A".repeat(150);
    const result = batchNameSchema.safeParse(exactName);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.length).toBe(150);
    }
  });

  it("rejects a batch name exceeding 150 characters", () => {
    const tooLongName = "A".repeat(151);
    const result = batchNameSchema.safeParse(tooLongName);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Batch name must not exceed 150 characters"
      );
    }
  });

  it("allows duplicate batch names across multiple invocations", () => {
    const name = "Conference Participants Batch A";
    const parse1 = batchInputSchema.safeParse({ name });
    const parse2 = batchInputSchema.safeParse({ name });

    expect(parse1.success).toBe(true);
    expect(parse2.success).toBe(true);
  });

  it("strips client-provided lifecycle and internal fields from input", () => {
    const payload = {
      name: "Valid Batch",
      status: "PUBLISHED",
      deletedAt: new Date().toISOString(),
      templateId: "cuid12345",
      publishedAt: new Date().toISOString(),
    };

    const parsed = batchInputSchema.parse(payload);
    expect(parsed).toEqual({ name: "Valid Batch" });
    expect((parsed as Record<string, unknown>).status).toBeUndefined();
    expect((parsed as Record<string, unknown>).deletedAt).toBeUndefined();
    expect((parsed as Record<string, unknown>).templateId).toBeUndefined();
    expect((parsed as Record<string, unknown>).publishedAt).toBeUndefined();
  });
});
