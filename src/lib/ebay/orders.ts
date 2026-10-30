import "server-only";

import { ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";

/**
 * Reads the seller's orders from eBay's Fulfillment API
 * (GET /sell/fulfillment/v1/order). Read-only: nothing here changes an order,
 * and buyer details are only passed through, never stored or logged.
 */

export type ShipTo = {
  fullName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  countryCode: string;
  phone: string;
};

export type EbayOrderLine = {
  lineItemId: string;
  title: string;
  sku: string;
  quantity: number;
  /** e.g. "Color: Black · Size: 36" for variation listings. */
  variation: string;
  legacyItemId: string;
};

export type EbayOrder = {
  orderId: string;
  createdAt: string;
  /** NOT_STARTED, IN_PROGRESS or FULFILLED. */
  fulfillmentStatus: string;
  paymentStatus: string;
  buyerUsername: string;
  total: string;
  /** What the sale brings in, in USD: items + shipping the buyer paid (no tax); null when not in USD. */
  saleValue: number | null;
  shipTo: ShipTo | null;
  lines: EbayOrderLine[];
};

export type OrdersResult =
  | { ok: true; orders: EbayOrder[]; total: number }
  | { ok: false; notConnected?: boolean; error: string };

type Amount = { value?: string; currency?: string };
type OrdersResponse = {
  total?: number;
  orders?: Array<{
    orderId?: string;
    creationDate?: string;
    orderFulfillmentStatus?: string;
    orderPaymentStatus?: string;
    buyer?: { username?: string };
    pricingSummary?: { total?: Amount; priceSubtotal?: Amount; deliveryCost?: Amount };
    fulfillmentStartInstructions?: Array<{
      shippingStep?: {
        shipTo?: {
          fullName?: string;
          contactAddress?: {
            addressLine1?: string;
            addressLine2?: string;
            city?: string;
            stateOrProvince?: string;
            postalCode?: string;
            countryCode?: string;
          };
          primaryPhone?: { phoneNumber?: string };
        };
      };
    }>;
    lineItems?: Array<{
      lineItemId?: string;
      title?: string;
      sku?: string;
      quantity?: number;
      legacyItemId?: string;
      variationAspects?: Array<{ name?: string; value?: string }>;
    }>;
  }>;
};

const s = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function money(amount: Amount | undefined) {
  const value = Number(amount?.value);
  if (!Number.isFinite(value)) return "";
  return amount?.currency && amount.currency !== "USD" ? `${value.toFixed(2)} ${amount.currency}` : `$${value.toFixed(2)}`;
}

function saleValue(summary: { priceSubtotal?: Amount; deliveryCost?: Amount } | undefined) {
  const usd = (a: Amount | undefined) => (a?.value != null && (!a.currency || a.currency === "USD") ? Number(a.value) : NaN);
  const items = usd(summary?.priceSubtotal);
  if (!Number.isFinite(items)) return null;
  const shipping = summary?.deliveryCost ? usd(summary.deliveryCost) : 0;
  return Math.round((items + (Number.isFinite(shipping) ? shipping : 0)) * 100) / 100;
}

export async function fetchEbayOrders(userId: number, options: { awaitingOnly: boolean }): Promise<OrdersResult> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return { ok: false, notConnected: true, error: "No eBay store connected. Connect your store in Settings." };

  const params = new URLSearchParams({ limit: "100" });
  // Without a creation-date filter eBay returns the last 90 days.
  if (options.awaitingOnly) params.set("filter", "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");
  const res = await ebayFetch<OrdersResponse>(`/sell/fulfillment/v1/order?${params}`, token);
  if (res.errors?.length) {
    console.error(`[ebay-orders] user ${userId}: fetching orders failed: ${ebayErrorMessage(res, "unknown error")}`);
    return { ok: false, error: ebayErrorMessage(res, "eBay did not return your orders.") };
  }

  const orders = (res.orders ?? []).map(toOrder);
  return { ok: true, orders, total: res.total ?? orders.length };
}

type RawOrder = NonNullable<OrdersResponse["orders"]>[number];

function toOrder(order: RawOrder): EbayOrder {
  const shipTo = order.fulfillmentStartInstructions?.find((i) => i.shippingStep?.shipTo)?.shippingStep?.shipTo;
  const address = shipTo?.contactAddress;
  return {
    orderId: s(order.orderId),
    createdAt: s(order.creationDate),
    fulfillmentStatus: s(order.orderFulfillmentStatus),
    paymentStatus: s(order.orderPaymentStatus),
    buyerUsername: s(order.buyer?.username),
    total: money(order.pricingSummary?.total),
    saleValue: saleValue(order.pricingSummary),
    shipTo: shipTo
      ? {
          fullName: s(shipTo.fullName),
          addressLine1: s(address?.addressLine1),
          addressLine2: s(address?.addressLine2),
          city: s(address?.city),
          stateOrProvince: s(address?.stateOrProvince),
          postalCode: s(address?.postalCode),
          countryCode: s(address?.countryCode),
          phone: s(shipTo.primaryPhone?.phoneNumber),
        }
      : null,
    lines: (order.lineItems ?? []).map((line) => ({
      lineItemId: s(line.lineItemId),
      title: s(line.title),
      sku: s(line.sku),
      quantity: typeof line.quantity === "number" ? line.quantity : 1,
      variation: (line.variationAspects ?? [])
        .filter((a) => a.name && a.value)
        .map((a) => `${a.name}: ${a.value}`)
        .join(" · "),
      legacyItemId: s(line.legacyItemId),
    })),
  };
}

/** One order by its eBay order id, or null when eBay doesn't return it. */
export async function fetchEbayOrder(userId: number, orderId: string): Promise<EbayOrder | null> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return null;
  const res = await ebayFetch<RawOrder>(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`, token);
  if (res.errors?.length || !res.orderId) {
    console.error(`[ebay-orders] user ${userId}: order ${orderId}: ${ebayErrorMessage(res, "not returned")}`);
    return null;
  }
  return toOrder(res);
}

/**
 * eBay carrier code for a CJ shipping method or tracking provider. eBay
 * knows the big carriers by name; CJ's own lines (CJPacket, YunExpress,
 * UniUni…) go out as "Other" with their tracking number.
 */
export function ebayCarrierCode(...names: Array<string | null | undefined>) {
  const text = names.filter(Boolean).join(" ").toLowerCase();
  if (/\busps\b/.test(text)) return "USPS";
  if (/\bups\b/.test(text)) return "UPS";
  if (/fedex/.test(text)) return "FedEx";
  if (/\bdhl\b/.test(text)) return "DHL";
  return "Other";
}

/**
 * Adds the tracking number to an eBay order (Fulfillment API
 * createShippingFulfillment), which also marks those lines shipped.
 */
export async function markEbayShipped(
  userId: number,
  orderId: string,
  shipment: { lineItems: Array<{ lineItemId: string; quantity: number }>; trackingNumber: string; carrier: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return { ok: false, error: "No eBay store connected." };
  const res = await ebayFetch(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`, token, {
    method: "POST",
    body: JSON.stringify({
      lineItems: shipment.lineItems,
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
    }),
  });
  if (res.errors?.length) {
    console.error(`[ebay-orders] user ${userId}: tracking for ${orderId} refused: ${ebayErrorMessage(res, "unknown error")}`);
    return { ok: false, error: ebayErrorMessage(res, "eBay didn't take the tracking number.") };
  }
  return { ok: true };
}
