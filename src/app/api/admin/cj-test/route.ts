import { hasAdminToken } from "@/lib/admin-token";
import { cjFetch, getCjAccessToken } from "@/lib/cj/client";

/**
 * Admin diagnostic for the CJ Dropshipping API. Nothing is stored.
 *   ?action=token                      token metadata (never the token itself)
 *   ?action=list                       GET /product/list?pageNum=1&pageSize=5
 *   ?action=detail&productId=<pid>     GET /product/query?pid=<pid>
 *   ?action=variants&productId=<pid>   GET /product/variant/query?pid=<pid>
 *   ?action=inventory&sku=<sku>        GET /product/stock/queryBySku?sku=<sku>
 *   ?action=inventoryTry&variantId=<vid>&sku=<sku>
 *                                      tries three candidate stock paths, one result each
 * Each response also lists every field path it contains (`fields`), to plan
 * the mapping to catalog_products. Needs the `x-admin-token: <CRON_SECRET>` header.
 */
export const dynamic = "force-dynamic";

/** Every field path in a JSON value, e.g. "data.list[].productImage". */
function fieldPaths(value: unknown, prefix = "", out = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) fieldPaths(item, `${prefix}[]`, out);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      out.add(path);
      fieldPaths(child, path, out);
    }
  }
  return [...out].sort();
}

function reply(action: string, body: unknown, status = 200) {
  console.log(`[cj-test] action=${action} response:`, JSON.stringify(body).slice(0, 20000));
  return Response.json(body, { status });
}

/** CJ's stock endpoint path is undocumented here; try the candidates one per second (CJ's limit). */
async function inventoryTry(apiKey: string, variantId: string, sku: string) {
  if (!variantId && !sku) return reply("inventoryTry", { ok: false, error: "Pass variantId and/or sku." }, 400);
  const token = await getCjAccessToken(apiKey);
  if (!token.ok) return reply("inventoryTry", { step: "token", ...token }, 502);

  const candidates = [
    variantId ? `/product/stock/queryByVid?vid=${encodeURIComponent(variantId)}` : null,
    sku ? `/product/variant/stock/queryBySku?sku=${encodeURIComponent(sku)}` : null,
    sku ? `/product/stock/query?sku=${encodeURIComponent(sku)}` : null,
  ].filter((p): p is string => Boolean(p));

  const attempts = [];
  for (const [i, path] of candidates.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
    console.log(`[cj-test] inventoryTry GET ${path}`);
    const body = await cjFetch(path, token.token);
    attempts.push({ request: `GET ${path}`, fields: fieldPaths(body), response: body });
  }
  return reply("inventoryTry", { ok: true, attempts });
}

export async function GET(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const apiKey = process.env.CJ_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { ok: false, error: "CJ_API_KEY is not set. Add it in Vercel → Settings → Environment Variables and redeploy." },
      { status: 500 },
    );
  }

  const params = new URL(request.url).searchParams;
  const action = params.get("action") ?? "";
  const productId = params.get("productId")?.trim() ?? "";
  const sku = params.get("sku")?.trim() ?? "";
  const variantId = params.get("variantId")?.trim() ?? "";

  if (action === "inventoryTry") return inventoryTry(apiKey, variantId, sku);

  const paths: Record<string, string | null> = {
    list: "/product/list?pageNum=1&pageSize=5",
    detail: productId ? `/product/query?pid=${encodeURIComponent(productId)}` : null,
    variants: productId ? `/product/variant/query?pid=${encodeURIComponent(productId)}` : null,
    inventory: sku ? `/product/stock/queryBySku?sku=${encodeURIComponent(sku)}` : null,
  };
  if (action !== "token" && !(action in paths)) return reply(action, { ok: false, error: "Unknown action" }, 400);
  if (action !== "token" && !paths[action]) {
    return reply(action, { ok: false, error: action === "inventory" ? "Missing sku parameter." : "Missing productId parameter." }, 400);
  }

  console.log(`[cj-test] action=${action} productId=${productId || "-"} sku=${sku || "-"}`);
  const token = await getCjAccessToken(apiKey);
  if (!token.ok) return reply(action, { step: "token", ...token }, 502);

  if (action === "token") {
    return reply(action, {
      ok: true,
      expiresAt: token.expiresAt.toISOString(),
      expirySource: token.expirySource,
      responseFields: token.responseFields,
      tokenLength: token.token.length,
    });
  }

  const path = paths[action] as string;
  console.log(`[cj-test] GET ${path}`);
  const body = await cjFetch(path, token.token);
  return reply(action, { ok: true, request: `GET ${path}`, fields: fieldPaths(body), response: body });
}
