/**
 * Listing defaults: the seller's own rules applied to every new listing.
 * Pure module (no server imports) so forms can validate with the same rules.
 */

import { EBAY_FINAL_VALUE_FEE, netProfitFor, priceBreakdown } from "@/lib/pricing";

/** eBay's standard final value fee, % (what pricing.ts charges before the seller's own extra fees). */
export const STANDARD_EBAY_FEE_PCT = Math.round(EBAY_FINAL_VALUE_FEE * 10000) / 100;

export type ListingDefaults = {
  /** "market": Match eBay Market Price (Free Shipping), see marketMatchPrice in src/lib/pricing.ts. */
  pricingMode: "suggested" | "markup" | "market";
  markupPct: number;
  adRatePct: number;
  /**
   * The seller's real eBay fee per sale, %. 13.55 is eBay's standard final value
   * fee; sellers outside the US selling in dollars pay more (international and
   * currency conversion fees): their eBay order page shows the real figure.
   */
  ebayFeePct: number;
  /** What paying suppliers in USD costs in currency conversion (card/PayPal rate), %; added to every supplier cost. */
  fxPct: number;
  quantityPerVariant: number;
  handlingDays: number;
  descriptionFooter: string;
};

export const DEFAULT_LISTING_DEFAULTS: ListingDefaults = {
  pricingMode: "suggested",
  markupPct: 40,
  /** Promoted Listings (General) ad rate every published listing gets; 0 turns it off. */
  adRatePct: 4,
  ebayFeePct: STANDARD_EBAY_FEE_PCT,
  fxPct: 0,
  quantityPerVariant: 10,
  handlingDays: 2,
  descriptionFooter: "",
};

/** Handling times eBay offers in its listing form (0 = same business day). */
export const HANDLING_OPTIONS = [0, 1, 2, 3, 4, 5, 10, 15, 20, 30];

export const FOOTER_MAX = 1000;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Turns any input (form body, database row) into safe, in-range defaults. */
export function normalizeDefaults(input: Partial<Record<keyof ListingDefaults, unknown>>): ListingDefaults {
  const d = DEFAULT_LISTING_DEFAULTS;
  const handling = Math.round(clamp(input.handlingDays, 0, 30, d.handlingDays));
  return {
    pricingMode: input.pricingMode === "markup" || input.pricingMode === "market" ? input.pricingMode : "suggested",
    markupPct: Math.round(clamp(input.markupPct, 0, 500, d.markupPct)),
    adRatePct: Math.round(clamp(input.adRatePct, 0, 30, d.adRatePct) * 10) / 10,
    ebayFeePct: Math.round(clamp(input.ebayFeePct, STANDARD_EBAY_FEE_PCT, 35, d.ebayFeePct) * 100) / 100,
    fxPct: Math.round(clamp(input.fxPct, 0, 20, d.fxPct) * 10) / 10,
    quantityPerVariant: Math.round(clamp(input.quantityPerVariant, 1, 100, d.quantityPerVariant)),
    handlingDays: HANDLING_OPTIONS.includes(handling) ? handling : d.handlingDays,
    descriptionFooter:
      typeof input.descriptionFooter === "string"
        ? input.descriptionFooter.replace(/\r\n/g, "\n").trim().slice(0, FOOTER_MAX)
        : d.descriptionFooter,
  };
}

/**
 * The % of each sale pricing.ts takes on top of the standard final value fee:
 * the Promoted Listings ad rate plus the seller's eBay fees above standard.
 * Every pricing and profit calculation passes this where it takes `adRatePct`.
 */
export function saleFeePct(d: Pick<ListingDefaults, "adRatePct" | "ebayFeePct">) {
  return Math.round((d.adRatePct + Math.max(0, d.ebayFeePct - STANDARD_EBAY_FEE_PCT)) * 100) / 100;
}

/** A supplier cost in USD as it really lands: plus the seller's currency conversion. */
export function landedCost(d: Pick<ListingDefaults, "fxPct">, usd: number) {
  return Math.round(usd * (1 + d.fxPct / 100) * 100) / 100;
}

/** Net profit per sale with the seller's real fees and conversion: what actually reaches them. */
export function realProfit(d: Pick<ListingDefaults, "adRatePct" | "ebayFeePct" | "fxPct">, listPrice: number, cost: number, shipping: number) {
  return netProfitFor(listPrice, landedCost(d, cost), landedCost(d, shipping), saleFeePct(d));
}

/** priceBreakdown with the seller's real fees and conversion ("Why this price"). */
export function realBreakdown(d: Pick<ListingDefaults, "adRatePct" | "ebayFeePct" | "fxPct">, listPrice: number, cost: number, shipping: number) {
  return priceBreakdown(listPrice, landedCost(d, cost), landedCost(d, shipping), saleFeePct(d));
}

/** Listing description with the seller's footer appended (once). */
export function withFooter(description: string, footer: string) {
  const body = description.trim();
  const tail = footer.trim();
  if (!tail || body.endsWith(tail)) return body;
  return body ? `${body}\n\n${tail}` : tail;
}

export function handlingLabel(days: number) {
  return days === 0 ? "Same business day" : `${days} business day${days === 1 ? "" : "s"}`;
}
