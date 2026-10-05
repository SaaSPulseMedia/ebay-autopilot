/**
 * Pure pricing helpers shared by the app and the seed script.
 * No database or server-only imports, so `tsx src/db/seed.ts` can use them.
 */

/** eBay US final value fee (most categories) and fixed per-order fee. */
export const EBAY_FINAL_VALUE_FEE = 0.1355;
export const EBAY_FIXED_FEE = 0.4;

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
