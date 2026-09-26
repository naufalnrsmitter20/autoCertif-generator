import Link from "next/link";
import { getActiveBatches } from "@/lib/batches";
import { BatchStatusBadge } from "@/components/batch-status-badge";
import { formatDisplayDate } from "@/lib/date";

export const metadata = {
  title: "Certificate Batches | AutoCertif Admin",
};

export default async function BatchesPage() {
  const batches = await getActiveBatches();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Certificate Batches
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Manage certificate generation batches.
          </p>
        </div>
        <div>
          <Link
            href="/admin/batches/new"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-100"
          >
            Create Batch
          </Link>
        </div>
      </div>

      {batches.length === 0 ? (
        <div
          data-testid="batches-empty-state"
          className="rounded-lg border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            No certificate batches found
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Get started by creating your first certificate batch.
          </p>
          <div className="mt-6">
            <Link
              href="/admin/batches/new"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-100"
            >
              Create Batch
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table
              data-testid="batches-table"
              className="min-w-full divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800"
            >
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-6 py-3.5">
                    Batch Name
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Template
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Created
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Last Updated
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {batches.map((batch) => (
                  <tr
                    key={batch.id}
                    data-testid={`batch-row-${batch.id}`}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <td className="px-6 py-4 font-medium text-zinc-900 dark:text-zinc-100">
                      <Link
                        href={`/admin/batches/${batch.id}`}
                        className="hover:underline focus:outline-none focus:ring-1 focus:ring-zinc-900 rounded dark:focus:ring-zinc-100"
                      >
                        {batch.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <BatchStatusBadge status={batch.status} />
                    </td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">
                      {batch.template ? (
                        <span className="text-zinc-900 dark:text-zinc-200 font-medium">
                          {batch.template.name}
                        </span>
                      ) : (
                        <span className="text-zinc-500 dark:text-zinc-500">
                          Not configured
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {formatDisplayDate(batch.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {formatDisplayDate(batch.updatedAt)}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <Link
                        href={`/admin/batches/${batch.id}`}
                        className="inline-flex items-center text-sm font-medium text-zinc-900 hover:text-zinc-700 underline focus:outline-none focus:ring-2 focus:ring-zinc-900 rounded px-1.5 py-1 dark:text-zinc-100 dark:hover:text-zinc-300 dark:focus:ring-zinc-100"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
