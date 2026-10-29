import { getCurrentUser } from "@/lib/auth";
import { getAccessTokenForUser } from "@/lib/ebay/client";
import { getEbayItemStatus } from "@/lib/ebay/item-status";
import { fetchEbayOrders } from "@/lib/ebay/orders";
import { findSimilar, likeSearch, runSourcing, similarResults } from "@/lib/sourcing";
import { screenVero } from "@/lib/vero";

/**
 * GET  /api/sourcing/like — the seller's best sellers on eBay (last 90 days)
 *      that are still live and carry no brand risk: starting points for "More like this".
 * POST /api/sourcing/like { title, again? } — queues CJ products like `title`
 *      (not with `again`, which only carries on checking), checks as many of
 *      them as time allows, and returns all of that search's products.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leaves room to answer inside Vercel's 60 s. */
const DEADLINE_MS = 48_000;
const BEST_SELLERS = 8;
/** Best sellers whose live status is looked up (GetItem, 1 s apart). */
const LOOKUPS = 15;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const [orders, token] = await Promise.all([fetchEbayOrders(user.id, { awaitingOnly: false }), getAccessTokenForUser(user.id)]);
  if (!orders.ok || !token) return Response.json({ ok: true, bestSellers: [] });
  // Only titles and counts leave here: no buyer details.
  const byItem = new Map<string, { itemId: string; title: string; sold: number }>();
  for (const order of orders.orders) {
    for (const line of order.lines) {
      if (!line.legacyItemId) continue;
      const row = byItem.get(line.legacyItemId) ?? { itemId: line.legacyItemId, title: line.title, sold: 0 };
      row.sold += line.quantity;
      byItem.set(line.legacyItemId, row);
    }
  }
  const candidates = [...byItem.values()]
    .filter((b) => screenVero(b.title).risk !== "high")
    .sort((a, b) => b.sold - a.sold)
    .slice(0, LOOKUPS);
  const bestSellers: Array<{ title: string; sold: number }> = [];
  for (const b of candidates) {
    if (bestSellers.length >= BEST_SELLERS) break;
    // Listings the seller has ended (e.g. taken down for brand reasons) aren't offered.
    const status = await getEbayItemStatus(b.itemId, token);
    if (status.state !== "ended") bestSellers.push({ title: b.title, sold: b.sold });
  }
  return Response.json({ ok: true, bestSellers });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const deadline = Date.now() + DEADLINE_MS;
  const body = (await request.json().catch(() => null)) as { title?: unknown; again?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  const search = likeSearch(title);
  if (!search) return Response.json({ ok: false, error: "Pick a best seller or type what to look for." }, { status: 400 });

  let queued = 0;
  if (body?.again !== true) {
    const found = await findSimilar(user.id, title);
    if (!found.ok) return Response.json(found, { status: 502 });
    queued = found.queued;
  }
  const run = await runSourcing(user.id, deadline, { checkOnly: true, niche: search.niche });
  const results = await similarResults(user.id, search.niche);
  return Response.json({
    ok: true,
    query: search.queries[0],
    queued,
    runError: run.ok ? null : run.error,
    results,
  });
}
