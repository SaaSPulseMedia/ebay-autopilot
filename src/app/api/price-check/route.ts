import { getCurrentUser } from "@/lib/auth";
import { connectedAccessToken } from "@/lib/listing-pipeline";
import { checkListingPrice } from "@/lib/price-check";

/**
 * POST /api/price-check { items: [{ itemId, title }] } — the Price check page
 * sends the seller's listings a few at a time (each takes eBay's GetItem plus
 * a market lookup, ~1–3 s) and gets each one's verdict back. Read only.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Listings per request: keeps each request well inside 60 s. */
const MAX_ITEMS = 6;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const token = await connectedAccessToken(user.id);
  if (!token) return Response.json({ ok: false, error: "Connect your eBay store in Settings first." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
  const items = (Array.isArray(body?.items) ? body.items : [])
    .map((raw) => {
      const item = raw as { itemId?: unknown; title?: unknown };
      return {
        itemId: typeof item.itemId === "string" ? item.itemId.replace(/\D/g, "") : "",
        title: typeof item.title === "string" ? item.title.trim().slice(0, 200) : "",
      };
    })
    .filter((item) => item.itemId && item.title);
  if (!items.length) return Response.json({ ok: false, error: "No listings to check." }, { status: 400 });
  if (items.length > MAX_ITEMS) return Response.json({ ok: false, error: `At most ${MAX_ITEMS} listings per request.` }, { status: 400 });

  const results = [];
  for (const item of items) results.push(await checkListingPrice(token, item));
  return Response.json({ ok: true, results });
}
