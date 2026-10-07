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

export type PriceBreakdown = {
  listPrice: number;
  cost: number;
  shipping: number;
  finalValueFee: number;
  fixedFee: number;
  adFee: number;
  profit: number;
  marginPct: number;
};

const cents = (value: number) => Math.round(value * 100) / 100;

/** Every line between the list price and what the seller keeps — shown as "Why this price". */
export function priceBreakdown(listPrice: number, cost: number, shipping = 0, adRatePct = 0): PriceBreakdown {
  const finalValueFee = cents(listPrice * EBAY_FINAL_VALUE_FEE);
  const adFee = cents((listPrice * adRatePct) / 100);
  const profit = cents(listPrice - cost - shipping - finalValueFee - EBAY_FIXED_FEE - adFee);
  return {
    listPrice: cents(listPrice),
    cost: cents(cost),
    shipping: cents(shipping),
    finalValueFee,
    fixedFee: EBAY_FIXED_FEE,
    adFee,
    profit,
    marginPct: listPrice > 0 ? Math.round((profit / listPrice) * 1000) / 10 : 0,
  };
}

/** What is left after supplier cost, shipping, and eBay fees. */
export function netProfitFor(listPrice: number, cost: number, shipping = 0, adRatePct = 0) {
  return priceBreakdown(listPrice, cost, shipping, adRatePct).profit;
}

/** Seller's pricing rule: AutoPilot's suggested price, or their own markup on cost + shipping. */
export function listPriceFor(
  rule: { pricingMode: "suggested" | "markup"; markupPct: number },
  cost: number,
  shipping: number,
  suggested: number,
) {
  return rule.pricingMode === "markup" ? priceFromMarkup(cost + shipping, rule.markupPct) : suggested;
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
