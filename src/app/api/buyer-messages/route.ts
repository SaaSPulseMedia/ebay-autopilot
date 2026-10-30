import { getCurrentUser } from "@/lib/auth";
import { getMessageSettings, runBuyerMessages, saveMessageSettings } from "@/lib/buyer-messages";

/**
 * GET  /api/buyer-messages — the thank-you message settings.
 * PUT  /api/buyer-messages { enabled, template } — saves them.
 * POST /api/buyer-messages — sends it now to new sales (instead of waiting for the hour).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, settings: await getMessageSettings(user.id) });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    return Response.json({ ok: true, settings: await saveMessageSettings(user.id, body ?? {}) });
  } catch (error) {
    const message = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    return Response.json({ ok: false, error: `Couldn't save: ${message.split("\n")[0].slice(0, 200)}` }, { status: 500 });
  }
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  return Response.json({ ok: true, run: await runBuyerMessages(user.id, Date.now() + 45_000) });
}
