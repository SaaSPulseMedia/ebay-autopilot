import { getCurrentUser } from "@/lib/auth";
import { fetchEbayOrders } from "@/lib/ebay/orders";
import { findSimilar, runSourcing } from "@/lib/sourcing";

/**
 * GET  /api/sourcing/like — the seller's best sellers on eBay (last 90 days),
 *      as starting points for "More like this".
 * POST /api/sourcing/like { title } — queues CJ products like `title` and
 *      checks as many as time allows (see findSimilar, runSourcing).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leaves room to answer inside Vercel's 60 s. */
const DEADLINE_MS = 50_000;
const BEST_SELLERS = 8;

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return Response.json(
      { ok: false, error: "Sign in first." },
      { status: 401 },
    );
  const orders = await fetchEbayOrders(user.id, { awaitingOnly: false });
  if (!orders.ok) return Response.json({ ok: true, bestSellers: [] });
  // Only titles and counts leave here: no buyer details.
  const byItem = new Map<string, { title: string; sold: number }>();
  for (const order of orders.orders) {
    for (const line of order.lines) {
      const key = line.legacyItemId || line.title;
      const row = byItem.get(key) ?? { title: line.title, sold: 0 };
      row.sold += line.quantity;
      byItem.set(key, row);
    }
  }
  const bestSellers = [...byItem.values()]
    .sort((a, b) => b.sold - a.sold)
    .slice(0, BEST_SELLERS);
  return Response.json({ ok: true, bestSellers });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return Response.json(
      { ok: false, error: "Sign in first." },
      { status: 401 },
    );
  const deadline = Date.now() + DEADLINE_MS;
  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
  } | null;
  const title =
    typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title)
    return Response.json(
      { ok: false, error: "Pick a best seller or type what to look for." },
      { status: 400 },
    );

  const found = await findSimilar(user.id, title);
  if (!found.ok) return Response.json(found, { status: 502 });
  const run = await runSourcing(user.id, deadline, { checkOnly: true });
  return Response.json({
    ok: true,
    queued: found.queued,
    query: found.query,
    run,
  });
}
