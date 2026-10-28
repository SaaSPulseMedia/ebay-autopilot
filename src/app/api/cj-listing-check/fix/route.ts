import { getCurrentUser } from "@/lib/auth";
import { fixCjListingPrice } from "@/lib/cj-listing-check";
import { connectedAccessToken } from "@/lib/listing-pipeline";
import { getListingDefaults } from "@/lib/seller-settings";

/**
 * POST /api/cj-listing-check/fix { listingId } — re-checks one CJ listing and,
 * when it loses money or keeps under the minimum profit, raises its price on
 * eBay (every variation) to the price that keeps the minimum. Prices only go up.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const token = await connectedAccessToken(user.id);
  if (!token) return Response.json({ ok: false, error: "Connect your eBay store in Settings first." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { listingId?: unknown } | null;
  const listingId = Number(body?.listingId);
  if (!Number.isInteger(listingId) || listingId <= 0) return Response.json({ ok: false, error: "No listing given." }, { status: 400 });

  const fix = await fixCjListingPrice(user.id, token, await getListingDefaults(user.id), listingId);
  return Response.json({ ok: true, fix });
}
