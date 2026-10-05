import Link from "next/link";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { ListingsTable } from "@/components/dashboard/ListingsTable";
import { getCurrentUser } from "@/lib/auth";
import { planLimits } from "@/lib/limits";
import { and, count, desc, eq, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Listings" };

export default async function ListingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const limits = planLimits(user.plan);

  const [rows, [{ count: activeUsed }]] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(eq(listings.userId, user.id))
      .orderBy(desc(listings.createdAt))
      .limit(100),
    db
      .select({ count: count() })
      .from(listings)
      .where(and(eq(listings.userId, user.id), ne(listings.status, "ended"))),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Listings</h1>
          <p className="mt-1 text-sm text-slate-400">
            {activeUsed} / {limits.activeListings} active listing slots used on {limits.planName} plan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/billing"
            className="rounded-full border border-white/20 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            Manage plan
          </Link>
          <Link
            href="/dashboard/bulk"
            className="ap-glow rounded-full bg-brand-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-400"
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

      <ListingsTable initialListings={rows} />
    </div>
  );
}
