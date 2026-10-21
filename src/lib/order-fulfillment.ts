import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { catalogProducts, listings } from "@/db/schema";
import { cjProductUrl } from "@/lib/cj/urls";
import { ebaySku } from "@/lib/variants";

/**
 * Traces an eBay order line's SKU back to the CJ product to buy:
 *   1. a CJ variant SKU (multi-variation listings use them as eBay SKUs);
 *   2. the seller's AutoPilot listing with that SKU, then its catalog product
 *      (recorded on listings since this feature; older ones are matched by
 *      their main image).
 * Lookups only; nothing is written.
 */

export type CjVariantOption = { sku: string; label: string };

export type CjMatch = {
  pid: string;
  productTitle: string;
  productUrl: string;
  /** The CJ SKU to order, when it is known exactly. */
  cjSku: string | null;
  /** e.g. "Black-36" for a matched variant. */
  cjVariant: string;
  /** All of the product's CJ variants, for picking when the exact one isn't known. */
  options: CjVariantOption[];
  matchedBy: "variant-sku" | "listing" | "listing-image";
};

type Variant = { sku: string; key?: string; name?: string };
type CatalogRow = { externalId: string; title: string; imageUrl: string | null; images: string[]; variants: Variant[] };


const pidOf = (externalId: string) => externalId.replace(/^cj-/, "");
const variantLabel = (v: Variant) => v.key || v.name || v.sku;

function match(product: CatalogRow, by: CjMatch["matchedBy"], variant?: Variant): CjMatch {
  const options = product.variants.map((v) => ({ sku: v.sku, label: variantLabel(v) }));
  // A product with a single variant has only one thing to order.
  const exact = variant ?? (product.variants.length === 1 ? product.variants[0] : undefined);
  return {
    pid: pidOf(product.externalId),
    productTitle: product.title,
    productUrl: cjProductUrl(pidOf(product.externalId), product.title),
    cjSku: exact?.sku ?? null,
    cjVariant: exact ? variantLabel(exact) : "",
    options,
    matchedBy: by,
  };
}

export async function matchSkusToCj(userId: number, skus: string[]): Promise<Record<string, CjMatch | null>> {
  const wanted = [...new Set(skus.filter(Boolean))];
  const result: Record<string, CjMatch | null> = {};
  if (!wanted.length) return result;

  const catalog = (await db
    .select({
      externalId: catalogProducts.externalId,
      title: catalogProducts.title,
      imageUrl: catalogProducts.imageUrl,
      images: catalogProducts.images,
      variants: catalogProducts.variants,
    })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.source, "cj"), eq(catalogProducts.userId, userId)))) as CatalogRow[];

  const byVariantSku = new Map<string, { product: CatalogRow; variant: Variant }>();
  const byExternalId = new Map<string, CatalogRow>();
  const byImage = new Map<string, CatalogRow>();
  for (const product of catalog) {
    byExternalId.set(product.externalId, product);
    for (const variant of product.variants ?? []) {
      if (variant?.sku) byVariantSku.set(ebaySku(variant.sku), { product, variant });
    }
    for (const url of [product.imageUrl, ...(product.images ?? [])]) if (url) byImage.set(url, product);
  }

  const rows = await db
    .select({ imageUrl: listings.imageUrl, payload: listings.payload })
    .from(listings)
    .where(eq(listings.userId, userId))
    .orderBy(desc(listings.createdAt))
    .limit(2000);
  const listingBySku = new Map<string, { imageUrl: string | null; externalId: string | null }>();
  for (const row of rows) {
    const payload = (row.payload ?? {}) as { sku?: unknown; externalId?: unknown; variations?: Array<{ sku?: unknown }> };
    const info = { imageUrl: row.imageUrl, externalId: typeof payload.externalId === "string" ? payload.externalId : null };
    const listingSkus = [payload.sku, ...(payload.variations ?? []).map((v) => v?.sku)];
    for (const sku of listingSkus) if (typeof sku === "string" && !listingBySku.has(sku)) listingBySku.set(sku, info);
  }

  for (const sku of wanted) {
    const variantHit = byVariantSku.get(sku);
    if (variantHit) {
      result[sku] = match(variantHit.product, "variant-sku", variantHit.variant);
      continue;
    }
    const listing = listingBySku.get(sku);
    const recorded = listing?.externalId ? byExternalId.get(listing.externalId) : undefined;
    if (recorded) {
      result[sku] = match(recorded, "listing");
      continue;
    }
    const byPicture = listing?.imageUrl ? byImage.get(listing.imageUrl) : undefined;
    result[sku] = byPicture ? match(byPicture, "listing-image") : null;
  }
  return result;
}
