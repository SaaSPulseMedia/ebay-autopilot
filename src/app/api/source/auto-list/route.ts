import "server-only";

import { randomUUID } from "node:crypto";

import { getCurrentUser } from "@/lib/auth";
import { cjExternalId, importCjProduct } from "@/lib/cj/catalog";
import { isEbaySandbox } from "@/lib/ebay/oauth";
import { planLimits } from "@/lib/limits";
import { checkPlanCapacity, connectedAccessToken, createListing } from "@/lib/listing-pipeline";
import { resolveListingPrice } from "@/lib/market-pricing";
import { realProfit } from "@/lib/listing-defaults";
import { MIN_PROFIT } from "@/lib/pricing";
import { withUserImages } from "@/lib/product-images";
import { getListingDefaults } from "@/lib/seller-settings";
import { getCatalogProduct } from "@/lib/suppliers";

/**
 * POST /api/source/auto-list { pid } — imports a CJ product into the catalog
 * and publishes it to the seller's eBay store straight away, with the same
 * pipeline, plan limits, VeRO screen and pricing rules as the Bulk list.
 * Never falls back to demo mode: without a connected store it refuses.
 */
export const dynamic = "force-dynamic";
// Same as Paste links: a big product can take over a minute to publish (300 s needs Fluid compute, on by default).
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { pid?: unknown } | null;
  const pid = typeof body?.pid === "string" ? body.pid.trim() : "";
  if (!pid || pid.length > 100) return Response.json({ ok: false, error: "Missing product id." }, { status: 400 });

  const accessToken = await connectedAccessToken(user.id);
  if (!accessToken) {
    return Response.json(
      { ok: false, code: "not_connected", error: "Connect your eBay store in Settings before auto-listing." },
      { status: 400 },
    );
  }

  const limits = planLimits(user.plan);
  const limitResponse = await checkPlanCapacity(user.id, limits, 1);
  if (limitResponse) return limitResponse;

  const imported = await importCjProduct(pid, user.id);
  if (!imported.ok) return Response.json({ ok: false, step: "import", error: imported.error }, { status: imported.status });

  const found = await getCatalogProduct(user.id, cjExternalId(pid));
  if (!found) return Response.json({ ok: false, step: "import", error: "The product didn't save. Try again." }, { status: 500 });
  const [product] = await withUserImages(user.id, [found]);

  if (product.veroRisk === "high") {
    return Response.json(
      { ok: false, step: "vero", error: `Not listed, to protect your eBay account: ${product.veroReason}` },
      { status: 422 },
    );
  }

  const defaults = await getListingDefaults(user.id);
  const price = await resolveListingPrice(defaults, product);
  const { listPrice, freeShipping } = price;
  if (price.rule === "low") {
    return Response.json({ ok: false, step: "pricing", error: `Low: not listed, ${price.reason}.` }, { status: 422 });
  }
  const profit = realProfit(defaults, listPrice, product.supplierPrice, product.shippingCost);
  // Backstop for the profit floor resolveListingPrice already prices to.
  if (profit < MIN_PROFIT) {
    return Response.json(
      {
        ok: false,
        step: "pricing",
        error: `Not listed: only $${profit.toFixed(2)} profit per sale after real shipping and eBay fees (the floor is $${MIN_PROFIT.toFixed(2)}).`,
      },
      { status: 422 },
    );
  }

  const result = await createListing({
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
    requested: "api",
    accessToken,
    drip: false,
    batchId: randomUUID(),
  });

  // Only a real eBay listing counts; a demo fallback (e.g. the listing had no image) is reported as a failure.
  if (result.status !== "published" || result.engine !== "api" || !result.itemId) {
    const reason = result.message.replace(/^Not listed\. Note: /, "");
    return Response.json(
      {
        ok: false,
        step: "publish",
        error: result.engine === "demo" ? `Not sent to eBay: ${reason}` : reason,
        imported: true,
      },
      { status: 502 },
    );
  }
  const host = isEbaySandbox() ? "https://www.sandbox.ebay.com" : "https://www.ebay.com";
  return Response.json({
    ok: true,
    itemId: result.itemId,
    itemUrl: `${host}/itm/${encodeURIComponent(result.itemId)}`,
    title: result.title,
    listPrice,
    variants: result.variants,
    message: result.message,
  });
}
