import { getCurrentUser } from "@/lib/auth";
import {
  getAutoOrderSettings,
  ownsCjWallet,
  runAutoOrdering,
  saveAutoOrderSettings,
} from "@/lib/auto-ordering";
import { getCjBalance } from "@/lib/cj/orders";

/**
 * GET  /api/fulfillment/auto — automatic ordering settings, whether this
 *      seller may pay from the CJ wallet, and the wallet balance.
 * PUT  /api/fulfillment/auto { mode, maxOrder, maxDay } — saves them.
 * POST /api/fulfillment/auto — runs automatic ordering now (instead of waiting for the hour).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEADLINE_MS = 50_000;

async function walletInfo(userId: number) {
  const canPay = await ownsCjWallet(userId);
  if (!canPay) return { canPay, balance: null, balanceError: null };
  const balance = await getCjBalance();
  return {
    canPay,
    balance: balance.ok ? balance.data : null,
    balanceError: balance.ok ? null : balance.error,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return Response.json(
      { ok: false, error: "Sign in first." },
      { status: 401 },
    );
  const [settings, wallet] = await Promise.all([
    getAutoOrderSettings(user.id),
    walletInfo(user.id),
  ]);
  return Response.json({ ok: true, settings, ...wallet });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user)
    return Response.json(
      { ok: false, error: "Sign in first." },
      { status: 401 },
    );
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  try {
    const settings = await saveAutoOrderSettings(user.id, body ?? {});
    return Response.json({ ok: true, settings, ...(await walletInfo(user.id)) });
  } catch (error) {
    // Said on the page, so a failure can be understood (no personal data in these errors).
    const message =
      error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    console.error("[auto-order] saving settings failed:", message);
    return Response.json({ ok: false, error: `Couldn't save: ${message.split("\n")[0].slice(0, 200)}` }, { status: 500 });
  }
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user)
    return Response.json(
      { ok: false, error: "Sign in first." },
      { status: 401 },
    );
  const run = await runAutoOrdering(user.id, Date.now() + DEADLINE_MS);
  return Response.json({ ok: true, run });
}
