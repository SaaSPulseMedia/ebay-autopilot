import { hasAdminToken } from "@/lib/admin-token";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_LOCATION_BODY } from "@/lib/ebay/account";
import { ebayRequest, getAccessTokenForUser } from "@/lib/ebay/client";

/**
 * TEMPORARY admin route: shows eBay's raw answers for the signed-in seller's
 * merchant locations — a list call, then an attempt to create a debug location.
 * Needs the `x-admin-token: <CRON_SECRET>` header and a session cookie.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const token = await getAccessTokenForUser(user.id);
  if (!token) return Response.json({ ok: false, error: "No usable eBay access token." });

  const list = await ebayRequest("/sell/inventory/v1/location?limit=5", token);

  const key = `autopilot-debug-${user.id}`;
  const create = await ebayRequest(`/sell/inventory/v1/location/${encodeURIComponent(key)}`, token, {
    method: "POST",
    body: JSON.stringify({ ...DEFAULT_LOCATION_BODY, name: "AutoPilot debug location" }),
  });

  const result = {
    ok: true,
    userId: user.id,
    list: { status: list.status, body: list.body },
    create: { key, status: create.status, body: create.body },
  };
  console.log("[ebay-location] debug:", JSON.stringify(result));
  return Response.json(result);
}
