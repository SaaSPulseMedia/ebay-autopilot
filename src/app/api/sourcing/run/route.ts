import { getCurrentUser } from "@/lib/auth";
import { runSourcing } from "@/lib/sourcing";

/** POST /api/sourcing/run — "Check now": one sourcing run for the signed-in seller (see runSourcing). */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leaves room to answer inside Vercel's 60 s. */
const DEADLINE_MS = 50_000;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const run = await runSourcing(user.id, Date.now() + DEADLINE_MS);
  return Response.json(run, { status: run.ok ? 200 : 409 });
}
