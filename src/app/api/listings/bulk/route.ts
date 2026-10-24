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
import { resolveListingPrice } from "@/lib/market-pricing";
import { MIN_PROFIT, netProfitFor } from "@/lib/pricing";
import { withRealShipping } from "@/lib/real-shipping";
import { getListingDefaults } from "@/lib/seller-settings";
import { withUserImages } from "@/lib/product-images";
import { getCatalog } from "@/lib/suppliers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One-click bulk listing from the catalog: the core of the product. */
/** Stop re-quoting CJ shipping after this long, so the request still answers in time. */
const QUOTE_BUDGET_MS = 35_000;

export async function POST(request: Request) {
  const started = Date.now();
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

  const [catalog, defaults] = await Promise.all([getCatalog(user.id, 200), getListingDefaults(user.id)]);
  // The seller's own image order (and uploads) replaces the supplier's images where saved.
  const found = await withUserImages(
    user.id,
    catalog.filter((product) => ids.includes(product.externalId)),
  );
  if (!found.length) {
    return Response.json({ ok: false, error: "None of those products are in the catalog." }, { status: 404 });
  }

  // Per-item VeRO gate: brand-name products are skipped, the rest of the batch still goes out.
  const blocked = found.filter((product) => product.veroRisk === "high");
  // Products without a real CJ shipping quote can't be priced safely, so they are skipped.
  const noShipping: Array<{ title: string; error: string }> = [];
  // One at a time: pricing may quote CJ shipping and look the product up on eBay (both rate-limited, cached).
  const priced = [];
  for (const candidate of found.filter((p) => p.veroRisk !== "high")) {
    if (!candidate.shippingQuoted && Date.now() - started > QUOTE_BUDGET_MS) {
      noShipping.push({ title: candidate.title, error: "Ran out of time checking CJ shipping. List it again." });
      continue;
    }
    const shipped = await withRealShipping(user.id, candidate);
    if (!shipped.ok) {
      noShipping.push({ title: candidate.title, error: shipped.error });
      continue;
    }
    const product = shipped.product;
    const price = await resolveListingPrice(defaults, product);
    const profit = netProfitFor(price.listPrice, product.supplierPrice, product.shippingCost, defaults.adRatePct);
    priced.push({ product, listPrice: price.listPrice, freeShipping: price.freeShipping, profit, price });
  }
  // Safety Margin Cap: priced down to the cheapest eBay listing + 5%, it would make under the profit floor.
  const low = priced.filter((row) => row.price.rule === "low");
  // Never publish below the profit floor (resolveListingPrice raises prices to it; this is the backstop).
  const losing = priced.filter((row) => row.price.rule !== "low" && row.profit < MIN_PROFIT);
  const selected = priced.filter((row) => row.price.rule !== "low" && row.profit >= MIN_PROFIT);

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
    ...noShipping.map(({ title, error }) => ({
      title,
      status: "skipped",
      variants: 0,
      message: `Not listed: ${error}`,
    })),
    ...low.map(({ product, price }) => ({
      title: product.title,
      status: "skipped",
      variants: 0,
      message: `Low: not listed, ${price.reason ?? "too little profit at a competitive eBay price"}.`,
    })),
    ...losing.map(({ product, profit }) => ({
      title: product.title,
      status: "skipped",
      variants: 0,
      message: `Not listed: only $${profit.toFixed(2)} profit per sale after real shipping and eBay fees (the floor is $${MIN_PROFIT.toFixed(2)}).`,
    })),
  );

  results.push(
    ...(await inChunks(selected, 5, ({ product, listPrice, freeShipping }) =>
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
          images: product.images,
          variants: product.variants,
          details: product.details,
          externalId: product.externalId,
          freeShipping,
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
