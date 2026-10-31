import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { buyerMessageSettings, buyerMessagesSent, cjOrders } from "@/db/schema";
import { getAccessTokenForUser } from "@/lib/ebay/client";
import { sendBuyerMessage } from "@/lib/ebay/messages";
import { type EbayOrder, fetchEbayOrder, fetchEbayOrders } from "@/lib/ebay/orders";
import { DEFAULT_MESSAGE, renderMessage } from "@/lib/message-template";

/**
 * The seller's thank-you message: once to the buyer of each new paid sale,
 * through eBay messaging, with {first_name}, {item} and {order} filled in.
 * Only sales whose CJ order AutoPilot follows get it, once that order is
 * paid (shows paid, shipped or tracking sent). Other sales (e.g. AliExpress,
 * or CJ bought with "Buy sample") are left to the seller to message by hand.
 * Runs hourly (the fulfillment job). Only sales after it was switched on get
 * it, each once (buyer_messages_sent); a failure is recorded, not retried.
 * The buyer's name is used to write the message and never stored or logged.
 */

export type MessageSettings = { enabled: boolean; template: string; enabledAt: Date | null };

/** eBay orders older than this are never messaged. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SUBJECT = "Your order is on its way";
/** CJ orders AutoPilot knows are paid. */
const PAID = ["paid", "shipped", "tracking_sent"];

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
  // All recent orders, not just "to ship": a CJ order can be shipped (tracking on eBay) by the time it shows paid.
  const [orders, token] = await Promise.all([fetchEbayOrders(userId, { awaitingOnly: false }), getAccessTokenForUser(userId)]);
  if (!orders.ok || !token) return run;

  const since = Math.max(settings.enabledAt.getTime(), Date.now() - MAX_AGE_MS);
  const fresh = orders.orders.filter((o) => o.paymentStatus === "PAID" && new Date(o.createdAt).getTime() >= since);
  if (!fresh.length) return run;
  const cjRecords = await db
      .select({ ebayOrderId: cjOrders.ebayOrderId, status: cjOrders.status })
      .from(cjOrders)
      .where(and(eq(cjOrders.userId, userId), eq(cjOrders.sandbox, false), inArray(cjOrders.ebayOrderId, fresh.map((o) => o.orderId))));
  const cjStatus = new Map(cjRecords.map((r) => [r.ebayOrderId, r.status]));

  for (const order of fresh) {
    if (Date.now() > deadline) break;
    const line = order.lines.find((l) => l.legacyItemId);
    if (!line || !order.buyerUsername) continue;
    // Only once AutoPilot has seen the sale's CJ order paid; anything else is the seller's to message.
    const status = cjStatus.get(order.orderId);
    if (!status || !PAID.includes(status)) continue;
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

/** The thank-you message as this order's buyer would get it, for the seller to check (and edit) before sending. */
export async function previewThankYou(userId: number, ebayOrderId: string): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  const [settings, order] = await Promise.all([getMessageSettings(userId), fetchEbayOrder(userId, ebayOrderId)]);
  if (!order) return { ok: false, error: "eBay didn't return this order. Refresh and try again." };
  const line = order.lines.find((l) => l.legacyItemId) ?? order.lines[0];
  return { ok: true, body: renderMessage(settings.template, { firstName: firstName(order), itemTitle: line?.title ?? "", orderId: order.orderId }) };
}

/** eBay's limit for a member message. */
const MAX_BODY = 2000;

/**
 * "Send message" on one order: the seller's thank-you message to that buyer
 * now (whether or not automatic sending is on), once per order. `edited` is
 * the text the seller checked (and maybe changed) in the preview.
 */
export async function sendThankYouNow(
  userId: number,
  ebayOrderId: string,
  edited?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [settings, order, token] = await Promise.all([getMessageSettings(userId), fetchEbayOrder(userId, ebayOrderId), getAccessTokenForUser(userId)]);
  if (!order || !token) return { ok: false, error: "eBay didn't return this order. Refresh and try again." };
  const line = order.lines.find((l) => l.legacyItemId);
  if (!line || !order.buyerUsername) return { ok: false, error: "eBay didn't give the buyer or item for this order." };
  const claimed = await db
    .insert(buyerMessagesSent)
    .values({ userId, ebayOrderId })
    .onConflictDoNothing()
    .returning({ id: buyerMessagesSent.ebayOrderId });
  if (!claimed.length) {
    const [row] = await db
      .select({ status: buyerMessagesSent.status })
      .from(buyerMessagesSent)
      .where(and(eq(buyerMessagesSent.userId, userId), eq(buyerMessagesSent.ebayOrderId, ebayOrderId)))
      .limit(1);
    // A failed attempt may be retried; a sent message is never sent twice.
    if (row?.status === "sent") return { ok: false, error: "Your message was already sent to this buyer." };
    await db
      .update(buyerMessagesSent)
      .set({ status: "sent", error: null, sentAt: new Date() })
      .where(and(eq(buyerMessagesSent.userId, userId), eq(buyerMessagesSent.ebayOrderId, ebayOrderId)));
  }
  const body = edited?.trim()
    ? edited.trim().slice(0, MAX_BODY)
    : renderMessage(settings.template, { firstName: firstName(order), itemTitle: line.title, orderId: order.orderId });
  const sent = await sendBuyerMessage(token, { itemId: line.legacyItemId, buyerUsername: order.buyerUsername, subject: SUBJECT, body });
  if (!sent.ok) {
    await db
      .update(buyerMessagesSent)
      .set({ status: "error", error: sent.error.slice(0, 500) })
      .where(and(eq(buyerMessagesSent.userId, userId), eq(buyerMessagesSent.ebayOrderId, ebayOrderId)));
    return { ok: false, error: `eBay didn't send it: ${sent.error}` };
  }
  return { ok: true };
}

/** The thank-you message's outcome for these orders: sent, or failed with eBay's reason (orders never tried are absent). */
export async function messageStatuses(userId: number, ebayOrderIds: string[]) {
  const out: Record<string, { sent: boolean; error: string | null }> = {};
  if (!ebayOrderIds.length) return out;
  const rows = await db
    .select({ id: buyerMessagesSent.ebayOrderId, status: buyerMessagesSent.status, error: buyerMessagesSent.error })
    .from(buyerMessagesSent)
    .where(and(eq(buyerMessagesSent.userId, userId), inArray(buyerMessagesSent.ebayOrderId, ebayOrderIds)));
  for (const r of rows) out[r.id] = { sent: r.status === "sent", error: r.status === "error" ? r.error : null };
  return out;
}
