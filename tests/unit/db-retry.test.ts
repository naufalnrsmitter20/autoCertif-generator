import { describe, expect, it, vi } from "vitest";
import { withPrismaConnectionRetry } from "@/lib/db-retry";

describe("withPrismaConnectionRetry", () => {
  it("retries a DNS failure and returns the eventual result", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("getaddrinfo EAI_AGAIN pooler"))
      .mockResolvedValue("connected");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(withPrismaConnectionRetry(operation)).resolves.toBe("connected");
      expect(operation).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not retry semantic failures", async () => {
    const failure = new Error("Certificate batch not found");
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(withPrismaConnectionRetry(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledOnce();
  });
});
