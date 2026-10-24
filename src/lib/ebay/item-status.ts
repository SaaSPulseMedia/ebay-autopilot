import "server-only";

import { isEbaySandbox } from "@/lib/ebay/oauth";

/**
 * Whether a listing is still live on eBay, from the Trading API's GetItem
 * (the REST Sell APIs have no "is this item live" lookup by item id). Works
 * with the seller's OAuth token. Calls go through one queue spaced at least
 * 1 s apart (per server instance), so a sync never bursts eBay.
 */

const GAP_MS = 1000;
const COMPATIBILITY_LEVEL = "1271";
/** GetItem: "listing has been deleted … or you are not the seller" — eBay's not-found. */
const NOT_FOUND_CODES = new Set(["17"]);

let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCallAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await task();
    } finally {
      lastCallAt = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

export type ItemStatus =
  /**
   * `price`: eBay's current price (the lowest variation's on a multi-variation listing), when it says.
   * `shipping`: what the buyer pays for the first (cheapest listed) domestic shipping option; 0 for free.
   */
  | { state: "active"; price: number | null; shipping: number | null }
  /** `listingStatus` is eBay's value (Completed, Ended) or "NotFound". */
  | { state: "ended"; listingStatus: string }
  /** eBay couldn't answer (network, auth, rate limit…); the caller leaves the row alone. */
  | { state: "unknown"; error: string };

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? "";

export function getEbayItemStatus(itemId: string, accessToken: string): Promise<ItemStatus> {
  return throttled(async () => {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId.replace(/\D/g, "")}</ItemID>
  <OutputSelector>Item.ItemID</OutputSelector>
  <OutputSelector>Item.SellingStatus.ListingStatus</OutputSelector>
  <OutputSelector>Item.SellingStatus.CurrentPrice</OutputSelector>
  <OutputSelector>Item.ShippingDetails.ShippingServiceOptions</OutputSelector>
</GetItemRequest>`;
    let xml: string;
    try {
      const res = await fetch(`${isEbaySandbox() ? "https://api.sandbox.ebay.com" : "https://api.ebay.com"}/ws/api.dll`, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "X-EBAY-API-CALL-NAME": "GetItem",
          "X-EBAY-API-SITEID": "0",
          "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
          "X-EBAY-API-IAF-TOKEN": accessToken,
        },
        body,
        cache: "no-store",
      });
      xml = await res.text();
      if (!res.ok && !xml.includes("<Ack>")) return { state: "unknown", error: `eBay returned HTTP ${res.status}` };
    } catch (error) {
      return { state: "unknown", error: error instanceof Error ? error.message : "Could not reach eBay." };
    }

    const listingStatus = tag(xml, "ListingStatus");
    if (listingStatus === "Active") {
      const price = Number(xml.match(/<CurrentPrice\b[^>]*>([^<]*)<\/CurrentPrice>/)?.[1]);
      const shippingBlock = xml.match(/<ShippingServiceOptions>([\s\S]*?)<\/ShippingServiceOptions>/)?.[1] ?? "";
      const free = /<FreeShipping>true<\/FreeShipping>/.test(shippingBlock);
      const cost = Number(shippingBlock.match(/<ShippingServiceCost\b[^>]*>([^<]*)<\/ShippingServiceCost>/)?.[1]);
      return {
        state: "active",
        price: Number.isFinite(price) && price > 0 ? price : null,
        shipping: free ? 0 : Number.isFinite(cost) && cost >= 0 ? cost : null,
      };
    }
    if (listingStatus) return { state: "ended", listingStatus };

    const codes = [...xml.matchAll(/<ErrorCode>(\d+)<\/ErrorCode>/g)].map((m) => m[1]);
    if (codes.some((code) => NOT_FOUND_CODES.has(code))) return { state: "ended", listingStatus: "NotFound" };
    return { state: "unknown", error: tag(xml, "LongMessage") || tag(xml, "ShortMessage") || "eBay gave no listing status." };
  });
}
