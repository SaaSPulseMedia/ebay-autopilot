import { db } from "@/db";
import { listings } from "@/db/schema";
import { BulkLister, type BulkProduct } from "@/components/dashboard/BulkLister";
import { getCurrentUser } from "@/lib/auth";
import { planLimits } from "@/lib/limits";
import { getCatalog, isSampleProduct, netProfit } from "@/lib/suppliers";
import { buildVariants } from "@/lib/variants";
import { and, count, eq, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bulk list" };

export default async function BulkPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const limits = planLimits(user.plan);
  const [catalog, [{ count: activeUsed }]] = await Promise.all([
    getCatalog(120),
    db
      .select({ count: count() })
      .from(listings)
      .where(and(eq(listings.userId, user.id), ne(listings.status, "ended"))),
  ]);

  const products: BulkProduct[] = catalog.map((product) => ({
    externalId: product.externalId,
    title: product.title,
    category: product.category,
    supplierPrice: product.supplierPrice,
    suggestedPrice: product.suggestedPrice,
    netProfit: netProfit(product),
    variants: buildVariants(product.title, product.category, product.suggestedPrice, limits.maxVariants).length,
    veroRisk: product.veroRisk,
    veroReason: product.veroReason,
  }));
  const sample = catalog.some(isSampleProduct);
  const blockedCount = products.filter((p) => p.veroRisk === "high").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Bulk listing</h1>
        <p className="mt-1 text-sm text-slate-400">
          Tick the products you want and press one button. AutoPilot writes each listing, expands the variants, applies
          your pricing, and publishes the batch. The same engine handles one product or a full batch.
        </p>
        {sample ? (
          <p className="mt-3 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs text-slate-300">
            These are starter products with <span className="text-white">example supplier prices</span>, not live
            quotes. Check the real cost with your supplier before you list.
          </p>
        ) : null}
        {blockedCount ? (
          <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {blockedCount} product{blockedCount === 1 ? " is" : "s are"} greyed out because the name includes a brand
            that removes unauthorized eBay listings (VeRO). They cannot be selected.
          </p>
        ) : null}
      </div>

      <BulkLister
        products={products}
        batchSize={limits.batchSize}
        activeListings={limits.activeListings}
        activeUsed={activeUsed}
        planName={limits.planName}
        isTrial={limits.isTrial}
      />
    </div>
  );
}
