import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAdminSession, requireAdmin, AdminAuthError } from "@/lib/auth/guard";
import { getServerSession } from "next-auth/next";
import { UserRole } from "@/generated/prisma/client";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

describe("Server-Side Authorization Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no session exists", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const session = await getAdminSession();
    expect(session).toBeNull();
  });

  it("throws AdminAuthError when requireAdmin is called without session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow(AdminAuthError);
  });

  it("rejects session with non-ADMIN role", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: {
        id: "user-123",
        email: "user@example.com",
        role: "USER" as unknown as UserRole,
      },
      expires: "2099-01-01",
    });

    const session = await getAdminSession();
    expect(session).toBeNull();
    await expect(requireAdmin()).rejects.toThrow(AdminAuthError);
  });

  it("returns verified AdminIdentity when session has ADMIN role", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: {
        id: "admin-456",
        email: "admin@autocertif.org",
        role: UserRole.ADMIN,
      },
      expires: "2099-01-01",
    });

    const session = await getAdminSession();
    expect(session).toEqual({
      id: "admin-456",
      email: "admin@autocertif.org",
      role: "ADMIN",
    });

    const admin = await requireAdmin();
    expect(admin).toEqual({
      id: "admin-456",
      email: "admin@autocertif.org",
      role: "ADMIN",
    });
  });
});
