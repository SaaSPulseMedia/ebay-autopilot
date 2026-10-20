import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { findNiche } from "@/lib/niches";
import { scoutWinners } from "@/lib/winning-agent";

/**
 * GET /api/source/auto-suggest?niche=… — "✨ Auto-Suggest Winners": a sourcing
 * run that only returns products this seller hasn't been shown before (see
 * scoutWinners in src/lib/winning-agent.ts): fresh Claude keywords, CJ search
 * minus seen products (deeper random pages if too few are new), Winning Score
 * and the eBay market check, best 30 returned and recorded as seen.
 * Takes the feed's filters too: minPrice, maxPrice, minMargin, maxSellers
 * (default 20), usOnly=1. Signed-in users only.
 */
export const dynamic = "force-dynamic";
// Claude, 5 keywords × 2–4 CJ calls spaced 1.1 s apart (plus deeper-page retries), then eBay lookups.
export const maxDuration = 60;

const DEFAULT_MAX_SELLERS = 20;

export async function GET(request: Request) {
  const started = Date.now();
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
    const result = await scoutWinners(
      user.id,
      niche,
      {
        minPrice: numberParam("minPrice"),
        maxPrice: numberParam("maxPrice"),
        minProfit: numberParam("minMargin"),
        maxSellers,
        usOnly: params.get("usOnly") === "1" || params.get("usOnly") === "true",
      },
      started,
    );
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, niche: niche.name, ...result.data });
  } catch (error) {
    console.error("[source] auto-suggest failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Couldn't find suggestions. Try again in a moment." }, { status: 500 });
  }
}
