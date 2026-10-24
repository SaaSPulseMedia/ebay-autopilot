import { getCurrentUser } from "@/lib/auth";
import { getSourcingOverview } from "@/lib/sourcing";

/** GET /api/sourcing — the seller's ready products, waiting count, last 24 h numbers and settings. */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, ...(await getSourcingOverview(user.id)) });
}
