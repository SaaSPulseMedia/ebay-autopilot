import { timingSafeEqual } from "node:crypto";

import { getCurrentUser } from "@/lib/auth";
import { setupSandboxPolicies } from "@/lib/ebay/policies-setup";

/**
 * TEMPORARY admin route: creates the signed-in seller's eBay business policies.
 * Needs the `x-admin-token: <CRON_SECRET>` header and a session cookie.
 */
export const dynamic = "force-dynamic";

function adminTokenMatches(given: string | null) {
  const expected = process.env.CRON_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!adminTokenMatches(request.headers.get("x-admin-token"))) {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const setup = await setupSandboxPolicies(user.id);
  const results = [
    { policy: "fulfillment", ...setup.fulfillment },
    { policy: "payment", ...setup.payment },
    { policy: "returns", ...setup.returns },
  ];

  console.log(`[seed-policies] user ${user.id} (${user.email}) opt-in:`, JSON.stringify(setup.optIn));
  for (const result of results) console.log(`[seed-policies] user ${user.id}:`, JSON.stringify(result));

  const errors = results.filter((r) => !r.ok);
  return errors.length
    ? Response.json({ ok: false, errors, results, optIn: setup.optIn })
    : Response.json({ ok: true, results, optIn: setup.optIn });
}
