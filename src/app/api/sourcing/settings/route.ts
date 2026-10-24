import { getCurrentUser } from "@/lib/auth";
import { saveSourcingSettings } from "@/lib/sourcing";

/** PUT /api/sourcing/settings { niches: string[], enabled: boolean } — what the sourcing checker searches. */
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { niches?: unknown; enabled?: unknown } | null;
  if (!body) return Response.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  const saved = await saveSourcingSettings(user.id, { niches: body.niches, enabled: body.enabled });
  return Response.json({ ok: true, ...saved });
}
