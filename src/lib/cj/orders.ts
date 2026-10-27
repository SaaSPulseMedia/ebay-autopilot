import "server-only";

import { type CjResult, cjGet } from "@/lib/cj/catalog";

/**
 * CJ's order API (Shopping): create an order for a buyer, and read its status
 * and tracking. Orders are created with payType 3 ("create only"): nothing is
 * paid from here, the seller pays each order in their CJ account. A sandbox
 * order (isSandbox 1) is a test CJ never charges, ships or fulfils.
 * Docs: developers.cjdropshipping.cn/en/api/api2/api/shopping.html
 */

export type CjOrderAddress = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  zip: string;
  countryCode: string;
  phone: string;
};

export type CjOrderInput = {
  /** Unique per CJ account: the eBay order id (a test order gets a suffix). */
  orderNumber: string;
  address: CjOrderAddress;
  /** CJ's name for the shipping method, as freightCalculate returns it, e.g. "CJPacket Ordinary". */
  logisticName: string;
  /** Warehouse country: "CN" or "US". */
  fromCountryCode: string;
  products: Array<{ sku: string; quantity: number; storeLineItemId: string }>;
  sandbox: boolean;
  remark?: string;
};

export type CjCreatedOrder = { cjOrderId: string; status: string; amount: number | null; warnings: string[] };

export type CjOrderStatus = {
  cjOrderId: string;
  /** CREATED, IN_CART, UNPAID, UNSHIPPED, SHIPPED, DELIVERED, CANCELLED… */
  status: string;
  trackNumber: string | null;
  logisticName: string | null;
  trackingProvider: string | null;
  amount: number | null;
};

const str = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const amountOf = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const clip = (value: string, max: number) => value.slice(0, max);

/** eBay gives US states as codes ("MN"); CJ says "Address incomplete" unless they are written out. */
const US_STATES: { [code: string]: string } = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
  AA: "Armed Forces Americas", AE: "Armed Forces Europe", AP: "Armed Forces Pacific",
};

/** The province as CJ wants it: a US state code written out in full; anything else as given. */
export function provinceName(province: string, countryCode: string) {
  const code = province.trim().toUpperCase();
  return countryCode.toUpperCase() === "US" ? (US_STATES[code] ?? province.trim()) : province.trim();
}

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export async function createCjOrder(input: CjOrderInput): Promise<CjResult<CjCreatedOrder>> {
  const a = input.address;
  const res = await cjGet("/shopping/order/createOrderV2", {
    method: "POST",
    body: JSON.stringify({
      orderNumber: clip(input.orderNumber, 50),
      shippingZip: clip(a.zip, 20),
      shippingCountryCode: a.countryCode,
      shippingCountry: clip(countryName(a.countryCode), 50),
      shippingProvince: clip(provinceName(a.province, a.countryCode), 50),
      shippingCity: clip(a.city, 50),
      shippingPhone: clip(a.phone.replace(/[^\d+]/g, ""), 20),
      shippingCustomerName: clip(a.name, 50),
      shippingAddress: clip(a.line1, 500),
      shippingAddress2: clip(a.line2, 500),
      remark: clip(input.remark ?? "", 500),
      logisticName: input.logisticName,
      fromCountryCode: input.fromCountryCode,
      payType: 3,
      isSandbox: input.sandbox ? 1 : 0,
      products: input.products.map((p) => ({ sku: p.sku, quantity: p.quantity, storeLineItemId: p.storeLineItemId })),
    }),
  });
  if (!res.ok) return res;
  const data = (res.data ?? {}) as Record<string, unknown>;
  const cjOrderId = str(data.orderId);
  const warnings = (Array.isArray(data.interceptOrderReasons) ? data.interceptOrderReasons : [])
    .map((r) => str((r as Record<string, unknown>)?.message))
    .filter(Boolean);
  if (!cjOrderId) {
    console.warn(`[cj-order] ${input.orderNumber}: CJ returned no order id: ${JSON.stringify(data).slice(0, 500)}`);
    return { ok: false, error: warnings[0] ?? "CJ didn't return an order id.", status: 502 };
  }
  return {
    ok: true,
    data: { cjOrderId, status: str(data.orderStatus) || "CREATED", amount: amountOf(data.orderAmount ?? data.actualPayment), warnings },
  };
}

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9+]/g, "");

/**
 * Sets the shipping method on a created CJ order (Get Order Optional
 * Logistics, then Modify Order Logistics): createOrderV2's logisticName
 * doesn't always stick, and CJ won't take an order to the cart without one.
 * Picks the method named `wanted`; when CJ doesn't offer it for this order,
 * the cheapest one from the same warehouse country, said in `note`.
 */
export async function setCjOrderLogistics(
  cjOrderId: string,
  wanted: string,
  fromCountryCode: string,
): Promise<CjResult<{ logisticsName: string; postage: number | null; note: string | null }>> {
  const info = await cjGet(`/shopping/order/getOrderLogisticsInfo?orderCode=${encodeURIComponent(cjOrderId)}`);
  if (!info.ok) return info;
  type Option = { id?: unknown; logisticsName?: unknown; logisticsNameAlias?: unknown; postage?: unknown; startCountry?: unknown; hasStock?: unknown };
  const options = (Array.isArray(info.data) ? info.data : []) as Option[];
  const id = (o: Option) => str(o.id);
  if (!options.some(id)) return { ok: false, error: "CJ offers no shipping method for this order yet; choose one on the order in CJ.", status: 422 };

  const fromUs = fromCountryCode === "US";
  const sameOrigin = (o: Option) => (/united states|usa|\bus\b/i.test(str(o.startCountry)) ? fromUs : !fromUs);
  const named = options.find((o) => id(o) && [str(o.logisticsName), str(o.logisticsNameAlias)].some((n) => n && squash(n) === squash(wanted)));
  const fallback = options
    .filter((o) => id(o) && sameOrigin(o) && o.hasStock !== false)
    .sort((a, b) => (amountOf(a.postage) ?? 9999) - (amountOf(b.postage) ?? 9999))[0];
  const pick = named ?? fallback;
  if (!pick) return { ok: false, error: `CJ doesn't offer ${wanted} for this order; choose a shipping method on the order in CJ.`, status: 422 };

  const logisticsName = str(pick.logisticsName);
  // The id is sent as a bare number, digit for digit (see readJson in client.ts).
  const body = JSON.stringify({ id: "__ID__", orderCode: cjOrderId, logisticsName, from: 1 }).replace('"__ID__"', /^\d+$/.test(id(pick)) ? id(pick) : JSON.stringify(id(pick)));
  const res = await cjGet("/shopping/order/updateLogistics", { method: "POST", body });
  if (!res.ok) return res;
  const data = (res.data ?? {}) as Record<string, unknown>;
  const blocked = Array.isArray(data.interceptAbnormalReasons) && data.interceptAbnormalReasons.length > 0;
  if (blocked) return { ok: false, error: `CJ refused ${logisticsName}: ${JSON.stringify(data.interceptAbnormalReasons).slice(0, 200)}`, status: 422 };
  return {
    ok: true,
    data: {
      logisticsName,
      postage: amountOf(pick.postage),
      note: named ? null : `CJ doesn't offer ${wanted} for this order, so the cheapest similar method was used: ${logisticsName}.`,
    },
  };
}

/**
 * Moves a created CJ order on to "Awaiting Payment" in the seller's CJ account,
 * the steps CJ's site calls Add to cart → Submit → Order confirmation:
 * addCart, addCartConfirm, then saveGenerateParentOrder (the payable order).
 * Nothing is paid. An order created with payType 3 otherwise waits under
 * "Imported Orders" for the seller to do these steps by hand.
 */
export async function submitCjOrder(cjOrderId: string): Promise<CjResult<{ shipmentOrderId: string }>> {
  const list = JSON.stringify({ cjOrderIdList: [cjOrderId] });
  const cart = await cjGet("/shopping/order/addCart", { method: "POST", body: list });
  if (!cart.ok) return cart;
  const cartData = (cart.data ?? {}) as Record<string, unknown>;
  // Already in the cart (a retry) counts as done; an intercepted order doesn't.
  const intercepted = Array.isArray(cartData.interceptOrders) && cartData.interceptOrders.length > 0;
  if (intercepted) return { ok: false, error: `CJ held the order: ${JSON.stringify(cartData.interceptOrders).slice(0, 200)}`, status: 422 };

  const confirm = await cjGet("/shopping/order/addCartConfirm", { method: "POST", body: list });
  if (!confirm.ok) return confirm;
  const confirmData = (confirm.data ?? {}) as Record<string, unknown>;
  const shipmentOrderId = str(confirmData.shipmentsId);
  if (confirmData.submitSuccess === false) return { ok: false, error: "CJ didn't confirm the order.", status: 422 };
  if (shipmentOrderId) {
    const parent = await cjGet("/shopping/order/saveGenerateParentOrder", { method: "POST", body: JSON.stringify({ shipmentOrderId }) });
    if (!parent.ok) console.warn(`[cj-order] ${cjOrderId}: payable order not generated (${parent.error}); it can still be paid in CJ.`);
  }
  return { ok: true, data: { shipmentOrderId } };
}

/** Status and tracking of a CJ order, by CJ order id or the orderNumber AutoPilot sent. */
export async function getCjOrder(orderId: string): Promise<CjResult<CjOrderStatus>> {
  const res = await cjGet(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}`);
  if (!res.ok) return res;
  const data = (res.data ?? null) as Record<string, unknown> | null;
  if (!data) return { ok: false, error: "CJ has no such order.", status: 404 };
  return {
    ok: true,
    data: {
      cjOrderId: str(data.orderId) || orderId,
      status: str(data.orderStatus).toUpperCase(),
      trackNumber: str(data.trackNumber) || null,
      logisticName: str(data.logisticName) || null,
      trackingProvider: str(data.trackingProvider) || null,
      amount: amountOf(data.orderAmount),
    },
  };
}
