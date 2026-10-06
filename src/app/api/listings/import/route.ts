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
import { netProfitFor, priceFromMarkup } from "@/lib/pricing";
import { extractProduct } from "@/lib/product-extract";
import { checkSupplierUrl } from "@/lib/supplier-policy";
import { screenVero } from "@/lib/vero";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Paste-a-list bulk lister: up to one batch of supplier links in, listings out.
 * Each link is policy-checked, read, priced at the seller's markup, VeRO-screened,
 * and only listed if it still makes a profit after eBay fees and the ad rate.
 */
export async function POST(request: Request) {
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

  const markupPct = clamp(body.markupPct, 0, 500, 40);
  const adRatePct = clamp(body.adRatePct, 0, 20, 0);
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

    const product = await extractProduct(url);
    if (!product.ok) return skip(supplier.host, product.note ?? "Could not read this page.");
    if (!product.price || product.price <= 0) {
      return skip(product.title, "No price found on the page. Use New listing to enter it by hand.");
    }

    const vero = screenVero(product.title);
    if (vero.risk === "high") return skip(product.title, `Skipped to protect your eBay account: ${vero.reason}`, "blocked");

    const listPrice = priceFromMarkup(product.price, markupPct);
    const profit = netProfitFor(listPrice, product.price, 0, adRatePct);
    if (profit <= 0) {
      return skip(
        product.title,
        `At ${markupPct}% markup this would lose $${Math.abs(profit).toFixed(2)} per sale after eBay fees. Raise your markup.`,
      );
    }

    const created = await createListing({
      userId: user.id,
      limits,
      source: {
        title: product.title,
        supplierPrice: product.price,
        listPrice,
        sourceUrl: product.url,
        imageUrl: product.imageUrl,
      },
      requested,
      accessToken,
      drip,
      batchId,
    });
    const notes = [supplier.warning, vero.risk === "medium" ? vero.reason : null].filter(Boolean).join(" ");
    return notes ? { ...created, message: `${created.message} Note: ${notes}` } : created;
  });

  return Response.json(summarizeBatch(batchId, urls.length, results));
}
