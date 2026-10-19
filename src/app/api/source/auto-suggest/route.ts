import "server-only";

import { suggestNicheKeywords } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { getKeywordWinners } from "@/lib/cj/catalog";
import { findNiche } from "@/lib/niches";

/**
 * GET /api/source/auto-suggest?niche=… — "✨ Auto-Suggest Winners": Claude
 * picks 5 product keywords for the niche (5 fixed keywords per niche if it
 * can't), each keyword is searched on CJ like the Source page, and the pooled,
 * de-duplicated results come back ranked by Winning Score (top 50).
 * Takes the feed's filters too: minPrice, maxPrice, minMargin, maxSellers
 * (default 20), usOnly=1. Signed-in users only.
 */
export const dynamic = "force-dynamic";
// Claude, then 5 keywords × 2 CJ calls spaced 1.1 s apart.
export const maxDuration = 60;

const DEFAULT_MAX_SELLERS = 20;
const LIMIT = 50;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const niche = findNiche(params.get("niche")?.trim() ?? "");
  if (!niche) return Response.json({ ok: false, error: "Pick a product niche first." }, { status: 400 });

  // Non-negative numbers only; anything else is ignored rather than rejected.
  const numberParam = (name: string) => {
    const raw = params.get(name)?.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const sellersParam = params.get("maxSellers");
  const maxSellers = sellersParam === "" || sellersParam === "any" ? undefined : (numberParam("maxSellers") ?? DEFAULT_MAX_SELLERS);

  try {
    const suggestion = await suggestNicheKeywords(niche.name, niche.fallback);
    const result = await getKeywordWinners(user.id, suggestion.keywords, {
      minPrice: numberParam("minPrice"),
      maxPrice: numberParam("maxPrice"),
      minProfit: numberParam("minMargin"),
      maxSellers,
      usOnly: params.get("usOnly") === "1" || params.get("usOnly") === "true",
      limit: LIMIT,
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({
      ok: true,
      niche: niche.name,
      keywords: suggestion.keywords,
      keywordSource: suggestion.source,
      searches: result.data.searches,
      products: result.data.products,
    });
  } catch (error) {
    console.error("[source] auto-suggest failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Couldn't find suggestions. Try again in a moment." }, { status: 500 });
  }
}
