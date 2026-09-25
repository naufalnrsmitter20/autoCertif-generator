import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/guard";
import { LogoutButton } from "./logout-button";

export const metadata = {
  title: "Admin Dashboard — AutoCertif",
};

export default async function AdminPage() {
  const admin = await getAdminSession();
  if (!admin) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              AutoCertif
            </span>
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {admin.role}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {admin.email}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Authentication Foundation Active
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Phase 2 ADMIN session verified. Ready for Phase 3 (Admin Shell &amp; Batch Management).
          </p>
        </div>
      </main>
    </div>
  );
}
