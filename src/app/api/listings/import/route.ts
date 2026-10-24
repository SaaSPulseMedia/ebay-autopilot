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
import { cjExternalId, importCjProduct } from "@/lib/cj/catalog";
import { cjPidFromUrl } from "@/lib/cj/urls";
import { resolveListingPrice } from "@/lib/market-pricing";
import { MIN_PROFIT, netProfitFor } from "@/lib/pricing";
import { withUserImages } from "@/lib/product-images";
import { getListingDefaults } from "@/lib/seller-settings";
import { checkSupplierUrl } from "@/lib/supplier-policy";
import { getCatalogProduct } from "@/lib/suppliers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Don't start another link after this long: each CJ link takes ~5 CJ calls spaced 1.1 s apart. */
const START_BEFORE_MS = 45_000;

/**
 * Paste-a-list bulk lister: up to one batch of CJ product links in, listings
 * out. Each link is policy-checked, then imported from CJ's API into the
 * catalog (importCjProduct), which also stores CJ's real shipping cost to the
 * US. It is priced at the seller's markup on the true landed cost (CJ cost +
 * real shipping + eBay's $0.40 order fee), raised to the profit floor
 * when short, VeRO-screened, and skipped as "Low" when that price is more than
 * 20% above the eBay market average (see resolveListingPrice). Links from
 * other suppliers are skipped: without CJ's freight quote there is no real
 * shipping cost to price them with.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    urls?: unknown;
    markupPct?: unknown;
    adRatePct?: unknown;
    drip?: unknown;
    engine?: unknown;
  };

  const urls = Array.from(
    new Set(
      (Array.isArray(body.urls) ? body.urls : [])
        .filter((url): url is string => typeof url === "string")
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  );
  if (!urls.length) {
    return Response.json({ ok: false, error: "Paste at least one supplier link." }, { status: 400 });
  }

  const defaults = await getListingDefaults(user.id);
  const markupPct = clamp(body.markupPct, 0, 500, defaults.markupPct);
  const adRatePct = clamp(body.adRatePct, 0, 30, defaults.adRatePct);
  const drip = body.drip === true;

  const limits = planLimits(user.plan);
  const limitResponse = await checkPlanCapacity(user.id, limits, urls.length, { drip });
  if (limitResponse) return limitResponse;

  const requested = parseEngine(body.engine);
  const accessToken = await connectedAccessToken(user.id);
  const batchId = randomUUID();
  const skip = (title: string, message: string, status = "skipped"): ItemResult => ({ title, status, variants: 0, message });

  const results = await inChunks(urls, 5, async (url): Promise<ItemResult> => {
    const supplier = checkSupplierUrl(url);
    if (!supplier.allowed) return skip(supplier.host, supplier.reason, "blocked");

    const pid = cjPidFromUrl(url);
    if (!pid) {
      return skip(
        supplier.host,
        "Only CJ Dropshipping product links can be listed here: AutoPilot prices with CJ's real shipping cost, which only CJ's API provides.",
      );
    }
    if (Date.now() - started > START_BEFORE_MS) {
      return skip(supplier.host, "Ran out of time for this batch. Paste this link again.");
    }

    const imported = await importCjProduct(pid, user.id);
    if (!imported.ok) return skip(supplier.host, `Not listed: ${imported.error}`);
    const found = await getCatalogProduct(user.id, cjExternalId(pid));
    if (!found) return skip(supplier.host, "The product didn't save. Try again.");
    const [product] = await withUserImages(user.id, [found]);

    if (product.veroRisk === "high") {
      return skip(product.title, `Skipped to protect your eBay account: ${product.veroReason}`, "blocked");
    }

    const price = await resolveListingPrice({ ...defaults, pricingMode: "markup", markupPct, adRatePct }, product);
    if (price.rule === "low") return skip(product.title, `Low: not listed, ${price.reason}.`);
    const profit = netProfitFor(price.listPrice, product.supplierPrice, product.shippingCost, adRatePct);
    if (profit < MIN_PROFIT) {
      return skip(
        product.title,
        `Not listed: only $${profit.toFixed(2)} profit per sale after real shipping and eBay fees (the floor is $${MIN_PROFIT.toFixed(2)}).`,
      );
    }

    const created = await createListing({
      userId: user.id,
      limits,
      defaults: { ...defaults, markupPct, adRatePct },
      source: {
        title: product.title,
        category: product.category,
        supplierPrice: product.supplierPrice,
        listPrice: price.listPrice,
        sourceUrl: product.supplierUrl,
        imageUrl: product.imageUrl,
        images: product.images,
        variants: product.variants,
        details: product.details,
        externalId: product.externalId,
        freeShipping: price.freeShipping,
      },
      requested,
      accessToken,
      drip,
      batchId,
    });
    const shippingNote = `Priced with CJ shipping $${product.shippingCost.toFixed(2)}${price.floorRaised ? `, ${price.reason}` : ""}.`;
    const notes = [shippingNote, supplier.warning, product.veroRisk === "medium" ? product.veroReason : null]
      .filter(Boolean)
      .join(" ");
    return notes ? { ...created, message: `${created.message} Note: ${notes}` } : created;
  });

  return Response.json(summarizeBatch(batchId, urls.length, results));
}
