import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";

export class AdminAuthError extends Error {
  constructor(message = "Unauthorized: ADMIN role required") {
    super(message);
    this.name = "AdminAuthError";
  }
}

export interface AdminIdentity {
  id: string;
  email: string;
  role: "ADMIN";
}

/**
 * Non-throwing server-side helper to read the current ADMIN session.
 * Returns the ADMIN identity if authenticated and role === ADMIN, otherwise null.
 */
export async function getAdminSession(): Promise<AdminIdentity | null> {
  const session = await getServerSession(authOptions);

  if (
    !session?.user?.id ||
    !session?.user?.email ||
    session.user.role !== UserRole.ADMIN
  ) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    role: "ADMIN",
  };
}

/**
 * Deterministic server-side authorization primitive.
 * Validates the session and ADMIN role, returning the verified ADMIN identity.
 * Throws AdminAuthError if unauthenticated or not an ADMIN.
 *
 * Server Components/pages should handle redirects explicitly (e.g. redirect("/login")).
 * Server Actions and Route Handlers should handle/map AdminAuthError at their own boundaries.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getAdminSession();
  if (!admin) {
    throw new AdminAuthError();
  }
  return admin;
}
