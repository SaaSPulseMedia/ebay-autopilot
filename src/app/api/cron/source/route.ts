import { cronAuthorized } from "@/lib/cron-auth";
import { runSourcing, sourcingSellers } from "@/lib/sourcing";

/**
 * GET /api/cron/source — the hourly sourcing check (GitHub Actions, like
 * /api/cron/release): for each seller with sourcing switched on, least
 * recently run first, finds and checks products while time allows (see
 * runSourcing in src/lib/sourcing.ts).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Stop starting sellers after this long; each run also watches the deadline itself. */
const DEADLINE_MS = 50_000;
/** A seller's run needs at least this long to check anything. */
const MIN_RUN_MS = 15_000;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Sourcing checks are not switched on: CRON_SECRET is not set." }, { status: 503 });
  }
  if (!cronAuthorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const deadline = Date.now() + DEADLINE_MS;
  try {
    const sellers = await sourcingSellers();
    const runs: Array<{ userId: number; checked?: number; ready?: number; error?: string }> = [];
    for (const userId of sellers) {
      if (deadline - Date.now() < MIN_RUN_MS) break;
      const run = await runSourcing(userId, deadline);
      runs.push(run.ok ? { userId, checked: run.checked, ready: run.ready } : { userId, error: run.error });
    }
    return Response.json({ ok: true, sellers: sellers.length, runs });
  } catch (error) {
    console.error("[cron/source] failed", error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = cause ?? (error instanceof Error ? error.message.split("\n")[0] : String(error));
    return Response.json({ ok: false, error: `Sourcing failed: ${message}` }, { status: 500 });
  }
}
