import { randomUUID } from "node:crypto";

import { getCurrentUser } from "@/lib/auth";
import { planLimits } from "@/lib/limits";
import {
  checkPlanCapacity,
  connectedAccessToken,
  createListing,
  inChunks,
  parseEngine,
  summarizeBatch,
  type ItemResult,
} from "@/lib/listing-pipeline";
import { listPriceFor, netProfitFor } from "@/lib/pricing";
import { getListingDefaults } from "@/lib/seller-settings";
import { getCatalog } from "@/lib/suppliers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One-click bulk listing from the catalog: the core of the product. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { externalIds?: unknown; engine?: unknown; drip?: unknown };
  const ids = Array.isArray(body.externalIds) ? body.externalIds.filter((id): id is string => typeof id === "string") : [];
  if (!ids.length) {
    return Response.json({ ok: false, error: "Select at least one product to list." }, { status: 400 });
  }
  const drip = body.drip === true;

  const limits = planLimits(user.plan);
  const limitResponse = await checkPlanCapacity(user.id, limits, ids.length, { drip });
  if (limitResponse) return limitResponse;

  const [catalog, defaults] = await Promise.all([getCatalog(200), getListingDefaults(user.id)]);
  const found = catalog.filter((product) => ids.includes(product.externalId));
  if (!found.length) {
    return Response.json({ ok: false, error: "None of those products are in the catalog." }, { status: 404 });
  }

  // Per-item VeRO gate: brand-name products are skipped, the rest of the batch still goes out.
  const blocked = found.filter((product) => product.veroRisk === "high");
  const priced = found
    .filter((product) => product.veroRisk !== "high")
    .map((product) => {
      const listPrice = listPriceFor(defaults, product.supplierPrice, product.shippingCost, product.suggestedPrice);
      return { product, listPrice, profit: netProfitFor(listPrice, product.supplierPrice, product.shippingCost, defaults.adRatePct) };
    });
  // Never publish something that loses money under the seller's own pricing rule.
  const losing = priced.filter((row) => row.profit <= 0);
  const selected = priced.filter((row) => row.profit > 0);

  const requested = parseEngine(body.engine);
  const accessToken = await connectedAccessToken(user.id);
  const batchId = randomUUID();

  const results: ItemResult[] = blocked.map((product) => ({
    title: product.title,
    status: "blocked",
    variants: 0,
    message: `Skipped to protect your eBay account: ${product.veroReason}`,
  }));
  results.push(
    ...losing.map(({ product, profit }) => ({
      title: product.title,
      status: "skipped",
      variants: 0,
      message: `Would lose $${Math.abs(profit).toFixed(2)} per sale after eBay fees at your current pricing. Raise your markup in Settings.`,
    })),
  );

  results.push(
    ...(await inChunks(selected, 5, ({ product, listPrice }) =>
      createListing({
        userId: user.id,
        limits,
        defaults,
        source: {
          title: product.title,
          category: product.category,
          supplierPrice: product.supplierPrice,
          listPrice,
          sourceUrl: product.supplierUrl,
          imageUrl: product.imageUrl,
        },
        requested,
        accessToken,
        drip,
        batchId,
      }),
    )),
  );

  return Response.json(summarizeBatch(batchId, found.length, results));
}
