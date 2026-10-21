import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { resolveListingPrice } from "@/lib/market-pricing";
import { priceBreakdown } from "@/lib/pricing";
import { getListingDefaults } from "@/lib/seller-settings";
import { getCatalog } from "@/lib/suppliers";

/**
 * POST /api/pricing/preview { externalIds } — the price each catalog product
 * would list at under the seller's pricing rule, with the rule used (Market
 * Match, the default, or Low) and the profit breakdown. The Bulk list calls
 * this in small batches for every pricing rule: Market Match needs an eBay
 * lookup per product, and any rule's price raised to the $5.00 floor is
 * checked against the eBay average (lookups are rate-limited, cached).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IDS = 20;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { externalIds?: unknown } | null;
  const ids = (Array.isArray(body?.externalIds) ? body.externalIds : [])
    .filter((id): id is string => typeof id === "string")
    .slice(0, MAX_IDS);
  if (!ids.length) return Response.json({ ok: false, error: "No products given." }, { status: 400 });

  const [catalog, defaults] = await Promise.all([getCatalog(user.id, 500), getListingDefaults(user.id)]);
  const wanted = new Set(ids);
  const prices = [];
  for (const product of catalog.filter((p) => wanted.has(p.externalId))) {
    const price = await resolveListingPrice(defaults, product);
    prices.push({
      externalId: product.externalId,
      ...price,
      breakdown: priceBreakdown(price.listPrice, product.supplierPrice, product.shippingCost, defaults.adRatePct),
    });
  }
  return Response.json({ ok: true, prices });
}
