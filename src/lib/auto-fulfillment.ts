import "server-only";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { cjOrders } from "@/db/schema";
import { type CjShippingOption, getCjShipping } from "@/lib/cj/catalog";
import { createCjOrder, getCjOrder, setCjOrderLogistics, submitCjOrder } from "@/lib/cj/orders";
import { ebayCarrierCode, type EbayOrder, fetchEbayOrder, markEbayShipped } from "@/lib/ebay/orders";
import { type CjMatch, matchSkusToCj } from "@/lib/order-fulfillment";

/**
 * Automatic fulfillment of eBay orders through CJ:
 *  1. placeCjOrder: creates the CJ order for an eBay order (buyer's address,
 *     the matched CJ variants, the chosen shipping method). Never pays: the
 *     seller pays it in their CJ account.
 *  2. syncCjOrders (hourly, and on demand): reads each open CJ order; once CJ
 *     has a tracking number it goes on the eBay order, which marks it shipped.
 * Test (sandbox) orders are never charged or shipped by CJ, and never touch
 * the eBay order. Buyer details are passed from eBay to CJ, never stored or logged.
 */

export type CjOrderRecord = typeof cjOrders.$inferSelect;

export type PreparedLine = {
  lineItemId: string;
  title: string;
  variation: string;
  quantity: number;
  match: CjMatch | null;
};

export type PreparedOrder = {
  order: EbayOrder;
  lines: PreparedLine[];
  /** CJ's methods to the US for the first matched item, cheapest first. */
  shipping: CjShippingOption[];
  shippingError: string | null;
  /** Units of the first item in CJ's US warehouses (0: only China shipping is offered); null when unknown. */
  usStock: number | null;
  record: CjOrderRecord | null;
};

/** Statuses still waiting on CJ (payment, shipping) or on eBay (tracking). */
const OPEN = ["created", "paid", "shipped"];

export async function getCjOrderRecords(userId: number, ebayOrderIds: string[]) {
  if (!ebayOrderIds.length) return [];
  return db
    .select()
    .from(cjOrders)
    .where(and(eq(cjOrders.userId, userId), inArray(cjOrders.ebayOrderId, ebayOrderIds)));
}

async function recordFor(userId: number, ebayOrderId: string) {
  const [row] = await getCjOrderRecords(userId, [ebayOrderId]);
  return row ?? null;
}

export async function prepareCjOrder(userId: number, ebayOrderId: string): Promise<{ ok: true; data: PreparedOrder } | { ok: false; error: string }> {
  const order = await fetchEbayOrder(userId, ebayOrderId);
  if (!order) return { ok: false, error: "eBay didn't return this order. Refresh and try again." };
  const matches = await matchSkusToCj(
    userId,
    order.lines.map((line) => line.sku),
  );
  const lines = order.lines.map((line) => ({
    lineItemId: line.lineItemId,
    title: line.title,
    variation: line.variation,
    quantity: line.quantity,
    match: line.sku ? (matches[line.sku] ?? null) : null,
  }));
  const first = lines.find((line) => line.match)?.match;
  let shipping: CjShippingOption[] = [];
  let shippingError: string | null = null;
  let usStock: number | null = null;
  if (first) {
    const quote = await getCjShipping(first.pid, first.cjSku);
    if (quote.ok) shipping = quote.data.options;
    else shippingError = quote.error;
    if (quote.ok) usStock = quote.data.usStock;
    if (quote.ok && !shipping.length) shippingError = "CJ has no shipping method to the US for this product right now.";
  }
  return { ok: true, data: { order, lines, shipping, shippingError, usStock, record: await recordFor(userId, ebayOrderId) } };
}

export type PlaceInput = {
  ebayOrderId: string;
  /** The CJ SKU to order for each eBay line, by lineItemId. */
  skus: Record<string, string>;
  logisticName: string;
  fromCountryCode: string;
  sandbox: boolean;
  /** Placed by automatic ordering. */
  auto?: boolean;
};

export async function placeCjOrder(
  userId: number,
  input: PlaceInput,
): Promise<{ ok: true; record: CjOrderRecord; warnings: string[]; shipmentOrderId: string | null } | { ok: false; error: string }> {
  const existing = await recordFor(userId, input.ebayOrderId);
  // "held": automatic ordering left it for the seller, who may now place it.
  if (existing && !existing.sandbox && !["error", "cancelled", "held"].includes(existing.status)) {
    return { ok: false, error: "A CJ order already exists for this eBay order. Check it in CJ (My CJ → Orders)." };
  }
  const prepared = await prepareCjOrder(userId, input.ebayOrderId);
  if (!prepared.ok) return prepared;
  const { order, lines, shipping } = prepared.data;
  if (order.fulfillmentStatus === "FULFILLED" && !input.sandbox) return { ok: false, error: "This eBay order is already marked shipped." };
  const to = order.shipTo;
  if (!to?.addressLine1 || !to.city || !to.countryCode) {
    return { ok: false, error: "eBay didn't give a full shipping address for this order. Check it in Seller Hub." };
  }

  // Each line must be one of its matched product's own CJ variants.
  const products: Array<{ sku: string; quantity: number; storeLineItemId: string }> = [];
  for (const line of lines) {
    const sku = input.skus[line.lineItemId] ?? line.match?.cjSku ?? "";
    if (!line.match) return { ok: false, error: `"${line.title}" isn't matched to a CJ product. Order it on CJ by hand.` };
    if (!sku || !line.match.options.some((option) => option.sku === sku)) {
      return { ok: false, error: `Pick the CJ variant for "${line.title}"${line.variation ? ` (${line.variation})` : ""}.` };
    }
    products.push({ sku, quantity: line.quantity, storeLineItemId: line.lineItemId });
  }
  const method = shipping.find((o) => o.method === input.logisticName && o.from === input.fromCountryCode);
  if (!method) return { ok: false, error: "Pick one of CJ's shipping methods for this order." };

  const orderNumber = input.sandbox ? `${input.ebayOrderId}-test-${Date.now().toString(36)}` : input.ebayOrderId;
  const created = await createCjOrder({
    orderNumber,
    address: {
      name: to.fullName,
      line1: to.addressLine1,
      line2: to.addressLine2,
      city: to.city,
      province: to.stateOrProvince,
      zip: to.postalCode,
      countryCode: to.countryCode,
      phone: to.phone,
    },
    logisticName: method.method,
    fromCountryCode: method.from,
    products,
    sandbox: input.sandbox,
    remark: `eBay order ${input.ebayOrderId}`,
  });

  // On to "Awaiting Payment" in CJ, so paying is the seller's only step there.
  let submitted: string | null = null;
  let shipmentOrderId: string | null = null;
  if (created.ok) {
    const ready = await readyForPayment(created.data.cjOrderId, method.method, method.from);
    if (ready.note) created.data.warnings.push(ready.note);
    if (ready.ok) shipmentOrderId = ready.shipmentOrderId;
    if (!ready.ok) {
      submitted = `Created, but CJ didn't move it to Awaiting Payment (${ready.error}). In CJ → Orders → Store Orders, choose the shipping method on the order, then Add to Orders Picking and pay.`;
      created.data.warnings.push(submitted);
    }
  }

  const values = {
    userId,
    ebayOrderId: input.ebayOrderId,
    cjOrderNumber: orderNumber,
    sandbox: input.sandbox,
    logisticName: method.method,
    fromCountry: method.from,
    updatedAt: new Date(),
    trackingNumber: null,
    carrier: null,
    ebayShippedAt: null,
    auto: input.auto ?? false,
    paidAt: null,
    note: null,
    ...(created.ok
      ? {
          cjOrderId: created.data.cjOrderId,
          status: "created",
          cjStatus: submitted ? created.data.status : "UNPAID",
          amount: created.data.amount != null ? created.data.amount.toFixed(2) : null,
          error: submitted,
        }
      : { cjOrderId: null, status: "error", cjStatus: null, amount: null, error: created.error }),
  };
  const [record] = await db
    .insert(cjOrders)
    .values(values)
    .onConflictDoUpdate({ target: [cjOrders.userId, cjOrders.ebayOrderId], set: values })
    .returning();
  console.info(
    `[cj-fulfill] user ${userId} eBay order ${input.ebayOrderId}: ${created.ok ? `CJ order ${created.data.cjOrderId} created` : `failed: ${created.error}`}${input.sandbox ? " (test)" : ""}`,
  );
  if (!created.ok) return { ok: false, error: `CJ didn't take the order: ${created.error}` };
  return { ok: true, record, warnings: created.data.warnings, shipmentOrderId };
}

/**
 * A created CJ order made ready to pay: its shipping method set (CJ doesn't
 * always keep the one sent with the order), then added to the cart and confirmed.
 */
async function readyForPayment(
  cjOrderId: string,
  logisticName: string,
  from: string,
): Promise<{ ok: true; note: string | null; shipmentOrderId: string | null } | { ok: false; error: string; note: string | null }> {
  const shipping = await setCjOrderLogistics(cjOrderId, logisticName, from);
  // Not fatal on its own: the order may already have a method; the cart step says if it hasn't.
  if (!shipping.ok) console.warn(`[cj-fulfill] ${cjOrderId}: shipping method not set: ${shipping.error}`);
  const note = shipping.ok ? shipping.data.note : null;
  const submit = await submitCjOrder(cjOrderId);
  if (!submit.ok) return { ok: false, error: shipping.ok ? submit.error : `${shipping.error} (${submit.error})`, note };
  return { ok: true, note, shipmentOrderId: submit.data.shipmentOrderId || null };
}

/** One open CJ order: reads its status on CJ and, once it has tracking, puts it on the eBay order. */
async function syncOne(row: CjOrderRecord): Promise<CjOrderRecord> {
  const now = new Date();
  const update = async (set: Partial<CjOrderRecord>) => {
    const [next] = await db
      .update(cjOrders)
      .set({ ...set, updatedAt: now })
      .where(and(eq(cjOrders.userId, row.userId), eq(cjOrders.ebayOrderId, row.ebayOrderId)))
      .returning();
    return next ?? row;
  };

  // Tracking found earlier but eBay refused it then: retry the eBay step only.
  if (row.status === "shipped" && row.trackingNumber) return sendTracking(row, update);

  let cj = await getCjOrder(row.cjOrderId ?? row.cjOrderNumber);
  if (!cj.ok) return update({ error: `Couldn't read the order on CJ: ${cj.error}` });
  // Created but never added to the cart (orders made before AutoPilot did this, or a failed try): do it now.
  if ((cj.data.status === "CREATED" || cj.data.status === "IN_CART") && row.cjOrderId) {
    const ready = await readyForPayment(row.cjOrderId, row.logisticName ?? "", row.fromCountry ?? "US");
    if (!ready.ok) return update({ cjStatus: cj.data.status, error: `Not yet in CJ's Awaiting Payment: ${ready.error}` });
    cj = await getCjOrder(row.cjOrderId);
    if (!cj.ok) return update({ error: `Couldn't read the order on CJ: ${cj.error}` });
  }
  const { status, trackNumber } = cj.data;
  if (status === "CANCELLED") return update({ status: "cancelled", cjStatus: status, error: null });
  if (trackNumber) {
    const carrier = ebayCarrierCode(cj.data.logisticName, cj.data.trackingProvider);
    const shipped = await update({ status: "shipped", cjStatus: status, trackingNumber: trackNumber, carrier, error: null });
    return sendTracking(shipped, update);
  }
  const paid = ["UNSHIPPED", "PENDING", "PROCESSING", "SHIPPED", "DELIVERED"].includes(status);
  return update({ status: paid ? "paid" : "created", cjStatus: status, ...(cj.data.amount != null ? { amount: cj.data.amount.toFixed(2) } : {}), error: null });
}

async function sendTracking(row: CjOrderRecord, update: (set: Partial<CjOrderRecord>) => Promise<CjOrderRecord>) {
  // A test order never touches the real eBay order.
  if (row.sandbox || !row.trackingNumber) return row;
  const order = await fetchEbayOrder(row.userId, row.ebayOrderId);
  if (!order) return update({ error: "Tracking is ready but eBay didn't return the order; will retry." });
  const sent = await markEbayShipped(row.userId, row.ebayOrderId, {
    lineItems: order.lines.map((line) => ({ lineItemId: line.lineItemId, quantity: line.quantity })),
    trackingNumber: row.trackingNumber,
    carrier: row.carrier ?? "Other",
  });
  if (!sent.ok) return update({ error: `eBay didn't take the tracking number: ${sent.error}` });
  console.info(`[cj-fulfill] user ${row.userId} eBay order ${row.ebayOrderId}: tracking sent, marked shipped`);
  return update({ status: "tracking_sent", ebayShippedAt: new Date(), error: null });
}

/** Syncs the seller's open CJ orders (newest 20), until `deadline`. */
export async function syncCjOrders(userId: number, deadline = Date.now() + 45_000) {
  const rows = await db
    .select()
    .from(cjOrders)
    .where(and(eq(cjOrders.userId, userId), inArray(cjOrders.status, OPEN), sql`${cjOrders.createdAt} > now() - interval '45 days'`))
    .orderBy(sql`${cjOrders.updatedAt} asc`)
    .limit(20);
  const synced: CjOrderRecord[] = [];
  for (const row of rows) {
    if (Date.now() > deadline) break;
    synced.push(await syncOne(row));
  }
  return synced;
}

/** Sellers with CJ orders still open, for the hourly sync. */
export async function sellersWithOpenCjOrders() {
  const rows = await db
    .selectDistinct({ userId: cjOrders.userId })
    .from(cjOrders)
    .where(and(inArray(cjOrders.status, OPEN), isNotNull(cjOrders.cjOrderNumber)));
  return rows.map((r) => r.userId);
}
