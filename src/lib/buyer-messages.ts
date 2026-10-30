import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { buyerMessageSettings, buyerMessagesSent } from "@/db/schema";
import { getAccessTokenForUser } from "@/lib/ebay/client";
import { sendBuyerMessage } from "@/lib/ebay/messages";
import { type EbayOrder, fetchEbayOrders } from "@/lib/ebay/orders";
import { DEFAULT_MESSAGE, renderMessage } from "@/lib/message-template";

/**
 * The seller's thank-you message: once to the buyer of each new paid sale,
 * through eBay messaging, with {first_name}, {item} and {order} filled in.
 * Runs hourly (the fulfillment job). Only sales after it was switched on get
 * it, each once (buyer_messages_sent); a failure is recorded, not retried.
 * The buyer's name is used to write the message and never stored or logged.
 */

export type MessageSettings = { enabled: boolean; template: string; enabledAt: Date | null };

/** eBay orders older than this are never messaged. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SUBJECT = "Your order is on its way";

export async function getMessageSettings(userId: number): Promise<MessageSettings> {
  const [row] = await db.select().from(buyerMessageSettings).where(eq(buyerMessageSettings.userId, userId)).limit(1);
  return row
    ? { enabled: row.enabled, template: row.template || DEFAULT_MESSAGE, enabledAt: row.enabledAt }
    : { enabled: false, template: DEFAULT_MESSAGE, enabledAt: null };
}

export async function saveMessageSettings(userId: number, input: { enabled?: unknown; template?: unknown }) {
  const current = await getMessageSettings(userId);
  const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const template = typeof input.template === "string" && input.template.trim() ? input.template.trim().slice(0, 1500) : current.template;
  // Switching on starts the clock: earlier sales never get the message.
  const enabledAt = !enabled ? null : current.enabled ? current.enabledAt : new Date();
  const values = { enabled, template, enabledAt, updatedAt: new Date() };
  await db
    .insert(buyerMessageSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: buyerMessageSettings.userId, set: values });
  return { enabled, template, enabledAt } satisfies MessageSettings;
}

export async function sellersWithMessages() {
  const rows = await db.select({ userId: buyerMessageSettings.userId }).from(buyerMessageSettings).where(eq(buyerMessageSettings.enabled, true));
  return rows.map((r) => r.userId);
}

const firstName = (order: EbayOrder) => order.shipTo?.fullName.trim().split(/\s+/)[0] ?? "";

export type MessageRun = { sent: number; failed: number };

/** Sends the thank-you message for the seller's new paid sales, until `deadline`. */
export async function runBuyerMessages(userId: number, deadline: number): Promise<MessageRun> {
  const run: MessageRun = { sent: 0, failed: 0 };
  const settings = await getMessageSettings(userId);
  if (!settings.enabled || !settings.enabledAt) return run;
  const [orders, token] = await Promise.all([fetchEbayOrders(userId, { awaitingOnly: true }), getAccessTokenForUser(userId)]);
  if (!orders.ok || !token) return run;

  const since = Math.max(settings.enabledAt.getTime(), Date.now() - MAX_AGE_MS);
  for (const order of orders.orders) {
    if (Date.now() > deadline) break;
    if (order.paymentStatus !== "PAID" || new Date(order.createdAt).getTime() < since) continue;
    const line = order.lines.find((l) => l.legacyItemId);
    if (!line || !order.buyerUsername) continue;
    // Claim it first: two runs at once never send it twice.
    const claimed = await db
      .insert(buyerMessagesSent)
      .values({ userId, ebayOrderId: order.orderId })
      .onConflictDoNothing()
      .returning({ id: buyerMessagesSent.ebayOrderId });
    if (!claimed.length) continue;

    const body = renderMessage(settings.template, { firstName: firstName(order), itemTitle: line.title, orderId: order.orderId });
    const sent = await sendBuyerMessage(token, { itemId: line.legacyItemId, buyerUsername: order.buyerUsername, subject: SUBJECT, body });
    if (sent.ok) {
      run.sent++;
    } else {
      run.failed++;
      console.warn(`[buyer-message] user ${userId} eBay order ${order.orderId}: not sent: ${sent.error}`);
      await db
        .update(buyerMessagesSent)
        .set({ status: "error", error: sent.error.slice(0, 500) })
        .where(and(eq(buyerMessagesSent.userId, userId), eq(buyerMessagesSent.ebayOrderId, order.orderId)));
    }
  }
  if (run.sent || run.failed) console.log(`[buyer-message] user ${userId}: ${JSON.stringify(run)}`);
  return run;
}
