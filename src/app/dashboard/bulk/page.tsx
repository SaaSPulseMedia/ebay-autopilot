import Link from "next/link";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { BulkLister, type BulkProduct } from "@/components/dashboard/BulkLister";
import { getCurrentUser } from "@/lib/auth";
import { DRIP_PER_RUN, planLimits } from "@/lib/limits";
import { listPriceFor, priceBreakdown } from "@/lib/pricing";
import { getListingDefaults } from "@/lib/seller-settings";
import { getCatalog, isSampleProduct } from "@/lib/suppliers";
import { buildVariants } from "@/lib/variants";
import { and, count, eq, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bulk list" };

export default async function BulkPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const limits = planLimits(user.plan);
  const [catalog, defaults, [{ count: activeUsed }]] = await Promise.all([
    getCatalog(120),
    getListingDefaults(user.id),
    db
      .select({ count: count() })
      .from(listings)
      .where(and(eq(listings.userId, user.id), ne(listings.status, "ended"))),
  ]);

  const products: BulkProduct[] = catalog.map((product) => {
    const listPrice = listPriceFor(defaults, product.supplierPrice, product.shippingCost, product.suggestedPrice);
    return {
    externalId: product.externalId,
    title: product.title,
    category: product.category,
    supplierPrice: product.supplierPrice,
    listPrice,
    breakdown: priceBreakdown(listPrice, product.supplierPrice, product.shippingCost, defaults.adRatePct),
    variants: buildVariants(product.title, product.category, product.suggestedPrice, limits.maxVariants).length,
    veroRisk: product.veroRisk,
    veroMatch: product.veroMatch,
    veroReason: product.veroReason,
    };
  });
  const sample = catalog.some(isSampleProduct);
  const blockedCount = products.filter((p) => p.veroRisk === "high").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Bulk listing</h1>
        <p className="mt-1 text-sm text-slate-400">
          Tick the products you want and press one button. AutoPilot writes each listing, expands the variants, applies
          your pricing, and publishes the batch. The same engine handles one product or a full batch. Have your own
          supplier links?{" "}
          <Link href="/dashboard/import" className="font-semibold text-brand-400 hover:text-brand-500">
            Paste a list instead →
          </Link>
        </p>
        <p className="mt-3 text-xs text-slate-400">
          Prices use{" "}
          <span className="text-white">
            {defaults.pricingMode === "markup" ? `your ${defaults.markupPct}% markup` : "AutoPilot's suggested price"}
          </span>
          {defaults.adRatePct ? <> with a {defaults.adRatePct}% ad rate</> : null}.{" "}
          <Link href="/dashboard/settings" className="font-semibold text-brand-400 hover:text-brand-500">
            Change in Settings
          </Link>
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
        dripAllowed={limits.dripPosting}
        dripPerRun={DRIP_PER_RUN}
      />
    </div>
  );
}
