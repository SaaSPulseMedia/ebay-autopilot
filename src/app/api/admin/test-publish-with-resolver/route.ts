import { hasAdminToken } from "@/lib/admin-token";
import { getCurrentUser } from "@/lib/auth";
import { publishWithResolver } from "@/lib/ebay/publish-with-resolver";

/**
 * Admin diagnostic: resolves the category for ?title= and publishes a real
 * listing to the signed-in seller's connected store (each call creates one).
 *   ?price=<number>  defaults to 9.99
 *   ?category=…      reserved, unused
 * Needs the `x-admin-token: <CRON_SECRET>` header and a session cookie.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim();
  if (!title) return Response.json({ ok: false, error: "Missing title parameter." }, { status: 400 });
  const price = params.has("price") ? Number(params.get("price")) : 9.99;
  if (!Number.isFinite(price) || price <= 0) {
    return Response.json({ ok: false, error: "price must be a positive number." }, { status: 400 });
  }

  const result = await publishWithResolver({
    userId: user.id,
    sku: `autopilot-resolver-test-${Date.now()}`,
    title,
    description: `Test listing created by AutoPilot to verify category resolution and publishing. Do not purchase.`,
    imageUrls: ["https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/640px-Example.jpg"],
    price,
    quantity: 1,
    condition: "NEW",
  });

  console.log(`[ebay-publish] resolver test for user ${user.id}:`, JSON.stringify(result));
  return Response.json(result);
}
