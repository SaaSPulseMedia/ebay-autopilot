import Link from "next/link";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Listings" };

export default async function ListingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.userId, user.id))
    .orderBy(desc(listings.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Listings</h1>
          <p className="mt-1 text-sm text-slate-400">Everything you have drafted or published from this account.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/bulk"
            className="ap-glow rounded-full bg-brand-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-400"
          >
            ⚡ Bulk list
          </Link>
          <Link
            href="/dashboard/listings/new"
            className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            New listing
          </Link>
        </div>
      </div>

      {rows.length ? (
        <div className="ap-card overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Variants</th>
                <th className="px-4 py-3">Engine</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">eBay item</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-white/5 last:border-0">
                  <td className="max-w-[320px] truncate px-4 py-3 text-white">{row.title}</td>
                  <td className="px-4 py-3 text-right text-slate-300">${Number(row.supplierPrice).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-white">${Number(row.listPrice).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{row.variantCount}</td>
                  <td className="px-4 py-3 text-slate-300">{row.engine}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] uppercase tracking-wide text-slate-200">
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{row.ebayItemId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ap-card rounded-2xl p-10 text-center text-sm text-slate-400">
          No listings yet. Start from the research feed or paste a supplier URL in the wizard.
        </p>
      )}
    </div>
  );
}
