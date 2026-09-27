import { describe, it, expect } from "vitest";
import {
  normalizeSearchQuery,
  escapeLikePattern,
  TECHNICAL_MAX_SEARCH_QUERY_LENGTH,
} from "@/lib/search/normalize";

describe("Public Search Query Normalization", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeSearchQuery("   Naufal   ")).toBe("Naufal");
    expect(normalizeSearchQuery("\t\n Budi Santoso \r\n")).toBe("Budi Santoso");
  });

  it("returns null for empty or whitespace-only inputs", () => {
    expect(normalizeSearchQuery("")).toBeNull();
    expect(normalizeSearchQuery("   ")).toBeNull();
    expect(normalizeSearchQuery("\t\n\r")).toBeNull();
  });

  it("returns null for non-string inputs", () => {
    expect(normalizeSearchQuery(null)).toBeNull();
    expect(normalizeSearchQuery(undefined)).toBeNull();
    expect(normalizeSearchQuery(12345)).toBeNull();
    expect(normalizeSearchQuery({})).toBeNull();
    expect(normalizeSearchQuery(["Alice"])).toBeNull();
  });

  it("preserves internal spaces, casing, punctuation, and Unicode characters", () => {
    expect(normalizeSearchQuery("Naufal Nabil Ramadhan")).toBe("Naufal Nabil Ramadhan");
    expect(normalizeSearchQuery("Dr. Siti Rahmawati, M.Kom.")).toBe("Dr. Siti Rahmawati, M.Kom.");
    expect(normalizeSearchQuery("François Müller")).toBe("François Müller");
  });

  it("defines TECHNICAL_MAX_SEARCH_QUERY_LENGTH as 1000", () => {
    expect(TECHNICAL_MAX_SEARCH_QUERY_LENGTH).toBe(1000);
  });
});

describe("PostgreSQL LIKE Pattern Escaping (escapeLikePattern)", () => {
  it("escapes percent sign (%)", () => {
    expect(escapeLikePattern("Alice % Bob")).toBe("Alice \\% Bob");
    expect(escapeLikePattern("100%")).toBe("100\\%");
  });

  it("escapes underscore (_)", () => {
    expect(escapeLikePattern("Charlie_Brown")).toBe("Charlie\\_Brown");
    expect(escapeLikePattern("_test_")).toBe("\\_test\\_");
  });

  it("escapes backslash (\\)", () => {
    expect(escapeLikePattern("Path\\Name")).toBe("Path\\\\Name");
  });

  it("escapes combined wildcard characters correctly in a single string", () => {
    expect(escapeLikePattern("100%_complete\\test")).toBe("100\\%\\_complete\\\\test");
  });

  it("leaves standard alphanumeric text untouched", () => {
    expect(escapeLikePattern("Naufal Nabil 123")).toBe("Naufal Nabil 123");
  });
});
