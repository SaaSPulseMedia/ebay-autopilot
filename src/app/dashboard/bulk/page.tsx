import "server-only";

import Link from "next/link";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { BulkLister, type BulkProduct } from "@/components/dashboard/BulkLister";
import { getCurrentUser } from "@/lib/auth";
import { DRIP_PER_RUN, planLimits } from "@/lib/limits";
import { listPriceFor, priceBreakdown } from "@/lib/pricing";
import { getListingDefaults } from "@/lib/seller-settings";
import { withUserImages } from "@/lib/product-images";
import { getCatalog } from "@/lib/suppliers";
import { listingVariants } from "@/lib/variants";
import { and, count, eq, isNotNull, ne, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bulk list" };

export default async function BulkPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const limits = planLimits(user.plan);
  const externalId = sql<string>`${listings.payload}->>'externalId'`;
  const [catalog, defaults, [{ count: activeUsed }], listedRows] = await Promise.all([
    getCatalog(user.id, 120),
    getListingDefaults(user.id),
    db
      .select({ count: count() })
      .from(listings)
      .where(and(eq(listings.userId, user.id), ne(listings.status, "ended"))),
    // Catalog products with a live or scheduled listing (listings made before payload.externalId aren't matched).
    db
      .selectDistinct({ externalId })
      .from(listings)
      .where(and(eq(listings.userId, user.id), ne(listings.status, "ended"), isNotNull(externalId))),
  ]);
  const listedIds = new Set(listedRows.map((r) => r.externalId));

  const withImages = await withUserImages(user.id, catalog);
  const products: BulkProduct[] = withImages.map((product) => {
    const listPrice = listPriceFor(defaults, product.supplierPrice, product.shippingCost, product.suggestedPrice);
    return {
    externalId: product.externalId,
    title: product.title,
    category: product.category,
    supplierPrice: product.supplierPrice,
    listPrice,
    breakdown: priceBreakdown(listPrice, product.supplierPrice, product.shippingCost, defaults.adRatePct),
    // Real supplier variants only; a product without them lists as one item.
    variants: listingVariants({
      sku: product.externalId,
      listPrice,
      supplierPrice: product.supplierPrice,
      quantity: defaults.quantityPerVariant,
      supplierVariants: product.variants,
      maxVariants: limits.maxVariants,
    }).length,
    veroRisk: product.veroRisk,
    veroMatch: product.veroMatch,
    veroReason: product.veroReason,
    imageUrl: product.imageUrl,
    imageCount: product.images.length || (product.imageUrl ? 1 : 0),
    customImages: product.customImages,
    // getCatalog returns only this seller's own products, so every one can be deleted.
    deletable: true,
    listed: listedIds.has(product.externalId),
    shippingQuoted: product.shippingQuoted,
    };
  });
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
            {defaults.pricingMode === "market"
              ? "Match eBay Market Price (Free Shipping) where it leaves $5+ profit, otherwise AutoPilot's suggested price"
              : defaults.pricingMode === "markup"
                ? `your ${defaults.markupPct}% markup`
                : "AutoPilot's suggested price"}
          </span>
          {defaults.adRatePct ? <> with a {defaults.adRatePct}% ad rate</> : null}, on CJ cost + CJ&apos;s real shipping,
          never below <span className="text-white">$5.00 profit</span> per sale.{" "}
          <Link href="/dashboard/settings" className="font-semibold text-brand-400 hover:text-brand-500">
            Change in Settings
          </Link>
        </p>
        {blockedCount ? (
          <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {blockedCount} product{blockedCount === 1 ? " is" : "s are"} greyed out because the name includes a brand
            that removes unauthorized eBay listings (VeRO). They cannot be selected.
          </p>
        ) : null}
      </div>

      {products.length ? (
        <BulkLister
          products={products}
          marketMode={defaults.pricingMode === "market"}
          batchSize={limits.batchSize}
          activeListings={limits.activeListings}
          activeUsed={activeUsed}
          planName={limits.planName}
          isTrial={limits.isTrial}
          dripAllowed={limits.dripPosting}
          dripPerRun={DRIP_PER_RUN}
        />
      ) : (
        <div className="ap-card rounded-2xl p-10 text-center">
          <p className="text-base font-semibold text-white">No products yet.</p>
          <p className="mt-1 text-sm text-slate-400">
            Find products on Source or Winning, add them to your catalog, and they&apos;ll show up here ready to list.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              href="/dashboard/source"
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-400"
            >
              Go to Source
            </Link>
            <Link
              href="/dashboard/winning"
              className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
            >
              🏆 Go to Winning
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
