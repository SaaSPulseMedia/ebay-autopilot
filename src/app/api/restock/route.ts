import { getCurrentUser } from "@/lib/auth";
import { getRestockSetting, runRestock, saveRestockSetting } from "@/lib/restock";

/**
 * GET  /api/restock — whether sold variants are put back in stock automatically.
 * PUT  /api/restock { restock } — switches it on or off.
 * POST /api/restock — restocks recent sales now (instead of waiting for the hour).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, restock: await getRestockSetting(user.id) });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { restock?: unknown } | null;
  try {
    return Response.json({ ok: true, restock: await saveRestockSetting(user.id, body?.restock === true) });
  } catch (error) {
    const message = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    return Response.json({ ok: false, error: `Couldn't save: ${message.split("\n")[0].slice(0, 200)}` }, { status: 500 });
  }
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, run: await runRestock(user.id, Date.now() + 45_000) });
}
