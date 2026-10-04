import { db } from "@/db";
import { listings, orders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [orderRows, listingRows] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, user.id)).limit(500),
    db.select().from(listings).where(eq(listings.userId, user.id)).limit(500),
  ]);

  const revenue = orderRows.reduce((sum, row) => sum + Number(row.salePrice), 0);
  const cogs = orderRows.reduce((sum, row) => sum + Number(row.cost), 0);
  const fees = orderRows.reduce((sum, row) => sum + Number(row.salePrice) * 0.1355 + 0.4, 0);
  const net = revenue - cogs - fees;

  const metrics = [
    { label: "Revenue", value: `$${revenue.toFixed(2)}` },
    { label: "Cost of goods", value: `$${cogs.toFixed(2)}` },
    { label: "eBay fees (est.)", value: `$${fees.toFixed(2)}` },
    { label: "Net profit", value: `$${net.toFixed(2)}` },
    { label: "Orders", value: String(orderRows.length) },
    { label: "Listings created", value: String(listingRows.length) },
    {
      label: "Avg. order value",
      value: orderRows.length ? `$${(revenue / orderRows.length).toFixed(2)}` : "$0.00",
    },
    {
      label: "Net margin",
      value: revenue > 0 ? `${((net / revenue) * 100).toFixed(1)}%` : "0.0%",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
        <p className="mt-1 text-sm text-slate-400">
          Totals calculated from this account&apos;s orders. Fees use eBay&apos;s 13.55% final value rate plus $0.40 per
          order.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="ap-card rounded-2xl p-5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{metric.label}</p>
            <p className="mt-2 text-2xl font-bold text-white">{metric.value}</p>
          </div>
        ))}
      </div>

      {!orderRows.length ? (
        <p className="ap-card rounded-2xl p-8 text-sm text-slate-400">
          No orders yet, so every total above is zero rather than a sample figure.
        </p>
      ) : null}
    </div>
  );
}
