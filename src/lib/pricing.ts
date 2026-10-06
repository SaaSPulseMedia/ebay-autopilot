/**
 * Pure pricing helpers shared by the app and the seed script.
 * No database or server-only imports, so `tsx src/db/seed.ts` can use them.
 */

/** eBay US final value fee (most categories) and fixed per-order fee. */
export const EBAY_FINAL_VALUE_FEE = 0.1355;
export const EBAY_FIXED_FEE = 0.4;

/** eBay fees on one sale: final value fee + fixed fee + optional promoted-listing ad rate. */
export function ebayFees(listPrice: number, adRatePct = 0) {
  return listPrice * (EBAY_FINAL_VALUE_FEE + adRatePct / 100) + EBAY_FIXED_FEE;
}

/** What is left after supplier cost, shipping, and eBay fees. */
export function netProfitFor(listPrice: number, cost: number, shipping = 0, adRatePct = 0) {
  return listPrice - cost - shipping - ebayFees(listPrice, adRatePct);
}

/** List price from a markup on supplier cost, e.g. 40% markup on $10 → $14.00. */
export function priceFromMarkup(cost: number, markupPct: number) {
  return Math.round(cost * (1 + markupPct / 100) * 100) / 100;
}

/** Price a supplier item for eBay so the net margin lands near 23% after fees. */
export function priceForEbay(cost: number) {
  const shipping = cost < 25 ? 4.25 : 0;
  const target = (cost + shipping + EBAY_FIXED_FEE) / (1 - EBAY_FINAL_VALUE_FEE - 0.23);
  const suggested = Math.max(cost + 6, Math.round(target * 100) / 100);
  return { shipping, suggested: Math.round(suggested * 100) / 100 };
}

export function competitionFor(sales: number): "low" | "medium" | "high" {
  if (sales > 900) return "high";
  if (sales > 350) return "medium";
  return "low";
}
