import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { getWinningProducts } from "@/lib/cj/catalog";

/**
 * GET /api/source/winning-products — CJ products ranked by Winning Score
 * (margin, competition, US warehouse, recency; see src/lib/winning-score.ts).
 * Optional: category, minPrice, maxPrice, minMargin (minimum net profit in
 * USD), maxSellers (default 20), usOnly=1, limit (default 24, max 60).
 * Signed-in users only.
 */
export const dynamic = "force-dynamic";
// A category runs up to ~10 CJ calls spaced 1.1 s apart.
export const maxDuration = 60;

const DEFAULT_MAX_SELLERS = 20;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  // Non-negative numbers only; anything else is ignored rather than rejected.
  const numberParam = (name: string) => {
    const raw = params.get(name)?.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const limit = Math.min(60, Math.max(1, Math.round(numberParam("limit") ?? 24)));
  const sellersParam = params.get("maxSellers");
  const maxSellers = sellersParam === "" || sellersParam === "any" ? undefined : (numberParam("maxSellers") ?? DEFAULT_MAX_SELLERS);

  try {
    const result = await getWinningProducts(user.id, {
      category: params.get("category")?.trim().slice(0, 100) || undefined,
      minPrice: numberParam("minPrice"),
      maxPrice: numberParam("maxPrice"),
      minProfit: numberParam("minMargin"),
      maxSellers,
      usOnly: params.get("usOnly") === "1" || params.get("usOnly") === "true",
      limit,
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, products: result.data });
  } catch (error) {
    console.error("[source] winning products failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Couldn't load winning products. Try again in a moment." }, { status: 500 });
  }
}
