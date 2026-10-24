import { getCurrentUser } from "@/lib/auth";
import { dismissCandidate } from "@/lib/sourcing";

/** POST /api/sourcing/dismiss { pid } — "Not for me": the product leaves the Products page for good. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { pid?: unknown } | null;
  const pid = typeof body?.pid === "string" ? body.pid.trim() : "";
  if (!pid || pid.length > 100) return Response.json({ ok: false, error: "No product given." }, { status: 400 });
  await dismissCandidate(user.id, pid);
  return Response.json({ ok: true });
}
