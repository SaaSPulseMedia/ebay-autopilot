import { sellersWithOpenCjOrders, syncCjOrders } from "@/lib/auto-fulfillment";
import { cronAuthorized } from "@/lib/cron-auth";

/**
 * GET /api/cron/fulfillment — the hourly CJ order check (GitHub Actions, like
 * /api/cron/release): for every seller with open CJ orders, reads their
 * status and puts new tracking numbers on the eBay orders.
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
    const sellers = await sellersWithOpenCjOrders();
    let synced = 0;
    let trackingSent = 0;
    for (const userId of sellers) {
      if (Date.now() > deadline) break;
      const records = await syncCjOrders(userId, deadline);
      synced += records.length;
      trackingSent += records.filter((r) => r.status === "tracking_sent").length;
    }
    return Response.json({ ok: true, sellers: sellers.length, synced, trackingSent });
  } catch (error) {
    console.error("[cron/fulfillment] failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) }, { status: 500 });
  }
}
