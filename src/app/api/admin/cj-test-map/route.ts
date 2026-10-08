import { hasAdminToken } from "@/lib/admin-token";
import { cjFetch, getCjAccessToken } from "@/lib/cj/client";
import { type CjProductFromApi, mapCjProductToDraft } from "@/lib/cj/mapper";

/**
 * Admin diagnostic: fetches one CJ product (?pid=…) and returns the catalog
 * draft mapCjProductToDraft makes from it. Nothing is stored.
 * Needs the `x-admin-token: <CRON_SECRET>` header.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const apiKey = process.env.CJ_API_KEY?.trim();
  if (!apiKey) return Response.json({ ok: false, error: "CJ_API_KEY is not set." }, { status: 500 });

  const pid = new URL(request.url).searchParams.get("pid")?.trim();
  if (!pid) return Response.json({ ok: false, error: "Missing pid parameter." }, { status: 400 });

  const token = await getCjAccessToken(apiKey);
  if (!token.ok) return Response.json({ step: "token", ...token }, { status: 502 });

  const body = (await cjFetch(`/product/query?pid=${encodeURIComponent(pid)}`, token.token)) as {
    data?: CjProductFromApi | null;
    message?: string;
  };
  const product = body?.data;
  if (!product || typeof product !== "object") {
    console.log(`[cj-test] map pid=${pid}: no product`, JSON.stringify(body).slice(0, 2000));
    return Response.json({ ok: false, error: body?.message ?? "CJ returned no product.", response: body }, { status: 502 });
  }

  const draft = mapCjProductToDraft(product);
  const rawVariants = Array.isArray(product.variants) ? product.variants : [];
  const mappedSkus = new Set(draft.variants.map((v) => v.sku));
  const skipped = rawVariants
    .filter((v) => !mappedSkus.has(typeof v.variantSku === "string" ? v.variantSku.trim() : ""))
    .map((v) => ({ variantSku: v.variantSku ?? null, variantKey: v.variantKey ?? null }));

  const checks = {
    rawVariantCount: rawVariants.length,
    mappedVariantCount: draft.variants.length,
    skippedVariants: skipped,
    variantsWithoutBarcode: draft.variants.filter((v) => !v.barcode).length,
    imageCount: draft.images.length,
    descriptionHasHtml: /<[a-z][\s\S]*>/i.test(draft.description),
    rawPriceFields: { sellPrice: product.sellPrice ?? null, suggestSellPrice: product.suggestSellPrice ?? null },
    rawWeight: product.productWeight ?? null,
  };
  console.log(`[cj-test] map pid=${pid}:`, JSON.stringify(checks));
  return Response.json({ ok: true, pid, draft, checks });
}
