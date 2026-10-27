import { getCurrentUser } from "@/lib/auth";
import { checkCjListing, cjListings } from "@/lib/cj-listing-check";
import { connectedAccessToken } from "@/lib/listing-pipeline";
import { getListingDefaults } from "@/lib/seller-settings";

/**
 * GET  /api/cj-listing-check — the seller's live CJ listings to check.
 * POST /api/cj-listing-check { listingIds } — checks a few (each: eBay's live
 *      price, CJ's stock-aware shipping, ~5 s), with the seller's real fees. Read only.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Listings per request: each takes an eBay call and ~4 CJ calls (1.1 s apart). */
const MAX_IDS = 3;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, listings: await cjListings(user.id) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const token = await connectedAccessToken(user.id);
  if (!token) return Response.json({ ok: false, error: "Connect your eBay store in Settings first." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { listingIds?: unknown } | null;
  const ids = (Array.isArray(body?.listingIds) ? body.listingIds : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, MAX_IDS);
  if (!ids.length) return Response.json({ ok: false, error: "No listings to check." }, { status: 400 });

  const defaults = await getListingDefaults(user.id);
  const results = [];
  for (const id of ids) {
    const result = await checkCjListing(user.id, token, defaults, id);
    if (result) results.push(result);
  }
  return Response.json({ ok: true, results });
}
