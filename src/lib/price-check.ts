import "server-only";

import { getEbayItemStatus } from "@/lib/ebay/item-status";
import { MAX_ABOVE_MARKET, getMarketPrice } from "@/lib/ebay/market-price";

/**
 * Price check for any of the seller's live eBay listings (made in AutoPilot
 * or not): its live price and shipping from eBay (GetItem), against what
 * buyers see for the same search on eBay (getMarketPrice: active listings'
 * average and lower quartile, or the sold median when eBay allows). Read
 * only: nothing on eBay is changed.
 */

export type PriceVerdict =
  /** More than 20% above the eBay average: the Market Guard would block it as a new listing. */
  | "overpriced"
  /** Above the price most buyers find it at (the reference), within 20% of the average. */
  | "high"
  /** At or under the reference: price isn't what stops buyers. */
  | "competitive"
  /** Too few similar listings on eBay to judge. */
  | "no_data"
  /** The listing isn't live any more. */
  | "ended"
  /** eBay couldn't be asked (try again later). */
  | "error";

export type PriceCheck = {
  itemId: string;
  title: string;
  verdict: PriceVerdict;
  /** Live item price and shipping charge on eBay. */
  price: number | null;
  shipping: number | null;
  /** Price + shipping: what buyers compare. */
  total: number | null;
  market: { average: number; reference: number; lowest: number; source: "sold" | "active"; count: number } | null;
  /** Item price that brings the total to the reference (shipping unchanged), for "overpriced" and "high". */
  suggestedPrice: number | null;
  note: string;
};

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;

/** Above the reference by less than this counts as at the market (rounding, small differences). */
const AT_MARKET = 0.05;

export async function checkListingPrice(token: string, item: { itemId: string; title: string }): Promise<PriceCheck> {
  const base = { itemId: item.itemId, title: item.title, price: null, shipping: null, total: null, market: null, suggestedPrice: null };
  const status = await getEbayItemStatus(item.itemId, token);
  if (status.state === "ended") return { ...base, verdict: "ended", note: "This listing has ended on eBay." };
  if (status.state === "unknown") return { ...base, verdict: "error", note: `eBay didn't answer (${status.error}). Try again later.` };
  if (status.price == null) return { ...base, verdict: "error", note: "eBay didn't give this listing's price." };

  const price = status.price;
  const shipping = status.shipping ?? 0;
  const total = cents(price + shipping);
  const priced = { ...base, price, shipping: status.shipping, total };

  const lookup = await getMarketPrice(item.title);
  if (!lookup.ok) return { ...priced, verdict: "error", note: `Couldn't look up eBay prices (${lookup.error}). Try again later.` };
  if (!lookup.market) {
    return { ...priced, verdict: "no_data", note: "Too few similar listings on eBay to compare. Price is probably not the problem." };
  }
  const m = lookup.market;
  const market = { average: m.average, reference: m.reference, lowest: m.lowest, source: m.referenceSource, count: m.count };
  const target = m.reference;
  // A shop price just under the target ("$29.99" for $30.00, "$24.99" for $25.01).
  const suggestedPrice = cents(Math.max(0.99, Math.floor(target - shipping) - 0.01));
  const shippingNote = shipping > 0 ? ` You also charge ${money(shipping)} shipping: most buyers prefer free shipping with it built into the price.` : "";
  const reference = m.referenceSource === "sold" ? "the typical sold price" : "the price most buyers find it at";

  if (total > m.average * (1 + MAX_ABOVE_MARKET)) {
    return {
      ...priced,
      market,
      verdict: "overpriced",
      suggestedPrice,
      note: `Buyers pay ${money(total)} with you vs ${money(m.average)} on average on eBay, and ${reference} is ${money(target)}. Lowering the item price to about ${money(suggestedPrice)} would put you in line, if your supplier cost allows.${shippingNote}`,
    };
  }
  if (total > target * (1 + AT_MARKET)) {
    return {
      ...priced,
      market,
      verdict: "high",
      suggestedPrice,
      note: `${money(total)} with you vs ${money(target)} for ${reference}: cheaper options appear next to yours. Consider about ${money(suggestedPrice)}, if your supplier cost allows.${shippingNote}`,
    };
  }
  return {
    ...priced,
    market,
    verdict: "competitive",
    note: `Your ${money(total)} is at or under ${reference} (${money(target)}). Price isn't what stops buyers: look at the delivery date shown, the main photo and the title.${shippingNote}`,
  };
}
