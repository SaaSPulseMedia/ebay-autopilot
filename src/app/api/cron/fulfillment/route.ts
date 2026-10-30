import { sellersWithOpenCjOrders, syncCjOrders } from "@/lib/auto-fulfillment";
import { runAutoOrdering, sellersWithAutoOrdering } from "@/lib/auto-ordering";
import { runBuyerMessages, sellersWithMessages } from "@/lib/buyer-messages";
import { cronAuthorized } from "@/lib/cron-auth";

/**
 * GET /api/cron/fulfillment — the hourly CJ order job (GitHub Actions, like
 * /api/cron/release): first automatic ordering (new eBay sales ordered, and
 * paid when the seller chose so, on CJ), then for every seller with open CJ
 * orders, reads their status and puts new tracking numbers on the eBay orders.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEADLINE_MS = 50_000;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "Scheduled jobs are not switched on: CRON_SECRET is not set." }, { status: 503 });
  }
  if (!cronAuthorized(request)) return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const deadline = Date.now() + DEADLINE_MS;
  try {
    const auto = { ordered: 0, paid: 0, held: 0 };
    // Automatic ordering gets at most half the time, so tracking still goes out.
    const autoDeadline = Date.now() + DEADLINE_MS / 2;
    for (const userId of await sellersWithAutoOrdering()) {
      if (Date.now() > autoDeadline) break;
      const run = await runAutoOrdering(userId, autoDeadline);
      auto.ordered += run.ordered;
      auto.paid += run.paid;
      auto.held += run.held;
    }

    const sellers = await sellersWithOpenCjOrders();
    let synced = 0;
    let trackingSent = 0;
    // Leaves the last 12 s for the thank-you messages.
    const syncDeadline = deadline - 12_000;
    for (const userId of sellers) {
      if (Date.now() > syncDeadline) break;
      const records = await syncCjOrders(userId, syncDeadline);
      synced += records.length;
      trackingSent += records.filter((r) => r.status === "tracking_sent").length;
    }
    // Thank-you messages last, so a CJ order just seen as paid above gets its message in this run.
    const messages = { sent: 0, failed: 0 };
    const messageDeadline = Date.now() + 10_000;
    for (const userId of await sellersWithMessages()) {
      if (Date.now() > messageDeadline) break;
      const run = await runBuyerMessages(userId, messageDeadline);
      messages.sent += run.sent;
      messages.failed += run.failed;
    }

    return Response.json({ ok: true, auto, messages, sellers: sellers.length, synced, trackingSent });
  } catch (error) {
    console.error("[cron/fulfillment] failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) }, { status: 500 });
  }
}
