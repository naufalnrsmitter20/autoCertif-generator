import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/guard";
import { LogoutButton } from "./logout-button";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdminSession();
  if (!admin) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sticky top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link
              href="/admin/batches"
              className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-telkom-red dark:focus:ring-zinc-100 rounded px-1"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-telkom-red inline-block shrink-0" aria-hidden="true" />
              <span>AutoCertif</span>
            </Link>
            <nav className="flex items-center gap-1">
              <Link
                href="/admin/batches"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              >
                Batches
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {admin.email}
              </span>
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {admin.role}
              </span>
            </div>
            <div className="sm:hidden">
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {admin.role}
              </span>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
