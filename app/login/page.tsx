import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/guard";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Admin Login — AutoCertif",
  description: "Sign in to AutoCertif Admin Console",
};

export default async function LoginPage() {
  const admin = await getAdminSession();
  if (admin) {
    redirect("/admin");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            AutoCertif
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Administrator Authentication
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Suspense fallback={<div className="py-8 text-center text-sm text-zinc-500">Loading form...</div>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
