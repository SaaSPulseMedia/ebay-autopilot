import Link from "next/link";

import { db } from "@/db";
import { listings, orders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { planLimits } from "@/lib/limits";
import { getCatalogStats } from "@/lib/suppliers";
import { and, count, desc, eq, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const limits = planLimits(user.plan);

  const [myListings, [{ count: activeListingsCount }], myOrders, stats] = await Promise.all([
    db.select().from(listings).where(eq(listings.userId, user.id)).orderBy(desc(listings.createdAt)).limit(5),
    db.select({ count: count() }).from(listings).where(and(eq(listings.userId, user.id), ne(listings.status, "ended"))),
    db.select().from(orders).where(eq(orders.userId, user.id)).limit(200),
    getCatalogStats(),
  ]);

  const revenue = myOrders.reduce((sum, order) => sum + Number(order.salePrice), 0);
  const cost = myOrders.reduce((sum, order) => sum + Number(order.cost), 0);
  const net = revenue - cost;

  const cards = [
    {
      label: "Active listings",
      value: `${activeListingsCount} / ${limits.activeListings}`,
      sub: `${limits.planName} plan`,
    },
    { label: "Orders", value: String(myOrders.length), sub: "All time" },
    { label: "Revenue", value: `$${revenue.toFixed(2)}`, sub: "Gross sales" },
    { label: "Net after cost", value: `$${net.toFixed(2)}`, sub: "Realized profit" },
  ];

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {user.storeName ? user.storeName : "Your store"} overview
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Every figure below is summed from your own account data. Empty totals mean you have not published yet.
          </p>
        </div>
        <div className="flex gap-2.5">
          <Link
            href="/dashboard/bulk"
            className="ap-glow rounded-full bg-brand-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-400"
          >
            ⚡ Bulk list
          </Link>
          <Link
            href="/dashboard/billing"
            className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            Manage plan
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="ap-card rounded-2xl p-5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-white">{card.value}</p>
            <p className="mt-1 text-xs text-slate-500">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="ap-card rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Recent listings</h2>
            <Link href="/dashboard/listings" className="text-sm font-semibold text-brand-400 hover:text-brand-500">
              View all listings →
            </Link>
          </div>
          {myListings.length ? (
            <ul className="mt-4 space-y-2">
              {myListings.map((listing) => (
                <li key={listing.id} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                  <span className="truncate pr-4 text-sm text-slate-200">{listing.title}</span>
                  <span className="shrink-0 rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] uppercase tracking-wide text-brand-400">
                    {listing.engine} · {listing.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-white/15 p-6 text-sm text-slate-400">
              Nothing published yet. Open <span className="text-white">Bulk list</span>, tick the products you want,
              and press one button — the whole batch is written, variant-built, and published for you.
            </p>
          )}
        </section>

        <section className="ap-card rounded-2xl p-6">
          <h2 className="text-base font-semibold text-white">Supplier catalog</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-400">Products loaded</dt>
              <dd className="font-semibold text-white">{stats.productCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Categories</dt>
              <dd className="font-semibold text-white">{stats.categoryCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Median net margin</dt>
              <dd className="font-semibold text-white">{stats.medianMarginPct.toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Avg. profit / unit</dt>
              <dd className="font-semibold text-white">${stats.averageNetProfit.toFixed(2)}</dd>
            </div>
          </dl>
          <Link
            href="/dashboard/bulk"
            className="ap-glow mt-5 block rounded-full bg-brand-500 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-brand-400"
          >
            ⚡ Bulk list products
          </Link>
          <Link
            href="/dashboard/research"
            className="mt-2 block rounded-full border border-white/20 px-4 py-2.5 text-center text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            Open research feed
          </Link>
        </section>
      </div>
    </div>
  );
}
