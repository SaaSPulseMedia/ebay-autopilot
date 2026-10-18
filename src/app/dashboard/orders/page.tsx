import { EbayOrders } from "@/components/dashboard/EbayOrders";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, user.id))
    .orderBy(desc(orders.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Orders &amp; fulfillment</h1>
        <p className="mt-1 text-sm text-slate-400">
          Your eBay orders, live from eBay. Press <span className="text-white">Fulfill on CJ</span>{" "}
          for the buyer&apos;s address and the CJ product to order.
        </p>
      </div>

      <EbayOrders />

      {rows.length ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Recorded orders</h2>
          <div className="ap-card overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3 text-right">Sale</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Tracking</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3 text-white">{row.buyerName}</td>
                    <td className="px-4 py-3 text-right text-slate-200">${Number(row.salePrice).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">${Number(row.cost).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-lime-brand">
                      ${(Number(row.salePrice) - Number(row.cost)).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.status.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-slate-400">{row.trackingNumber ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
