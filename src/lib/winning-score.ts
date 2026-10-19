import { EBAY_FINAL_VALUE_FEE, EBAY_FIXED_FEE, netProfitFor, priceForEbay } from "@/lib/pricing";

/**
 * Winning Score: how promising a CJ product looks to list on eBay, from CJ
 * data alone (eBay sold-item data needs Marketplace Insights API approval).
 *   40% margin       — net profit per sale at AutoPilot's suggested eBay price,
 *                      after cost, shipping and eBay fees (scored in dollars:
 *                      the suggested price targets ~23% net on everything, so
 *                      margin % alone barely tells products apart)
 *   30% competition  — fewer CJ sellers already listing it is better
 *   20% US warehouse — ships from CJ's US warehouse (faster, fewer returns)
 *   10% recency      — newer CJ products are fresher inventory
 * Pure: no I/O.
 */

export const WEIGHTS = { margin: 0.4, competition: 0.3, us: 0.2, recency: 0.1 } as const;

/** Net profit per sale (USD) that earns full marks for margin; $0 scores 0. */
const PROFIT_CEIL = 15;
/** Seller count that scores 0 for competition (log scale below it). */
const COMPETITION_CEIL = 1000;
/** Age at which a product's recency score reaches 0. */
const RECENCY_DAYS = 365;
/** Recency score when CJ doesn't say when the product was added. */
const RECENCY_UNKNOWN = 0.5;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export type WinningInput = {
  cost: number;
  listedNum: number;
  origin: "US" | "CN" | null;
  /** When CJ added the product; null when unknown. */
  createdAt: Date | null;
};

export type WinningBreakdown = {
  winningScore: number;
  /** Suggested eBay price and the money left after cost, shipping and eBay fees. */
  suggestedPrice: number;
  shipping: number;
  profit: number;
  /** Net margin, 0–1. */
  margin: number;
  /** Competition level from the seller count. */
  competition: "low" | "medium" | "high";
  parts: { margin: number; competition: number; us: number; recency: number };
};

export function competitionLevel(listedNum: number): "low" | "medium" | "high" {
  if (listedNum > 100) return "high";
  if (listedNum > 20) return "medium";
  return "low";
}

export function winningScore(input: WinningInput, now = Date.now()): WinningBreakdown {
  const { shipping, suggested } = priceForEbay(input.cost);
  const profit = netProfitFor(suggested, input.cost, shipping);
  const margin = suggested > 0 ? profit / suggested : 0;

  const parts = {
    margin: clamp01(profit / PROFIT_CEIL),
    competition: clamp01(1 - Math.log1p(Math.max(0, input.listedNum)) / Math.log1p(COMPETITION_CEIL)),
    us: input.origin === "US" ? 1 : 0,
    recency: input.createdAt
      ? clamp01(1 - (now - input.createdAt.getTime()) / (RECENCY_DAYS * 24 * 60 * 60 * 1000))
      : RECENCY_UNKNOWN,
  };
  const total =
    WEIGHTS.margin * parts.margin +
    WEIGHTS.competition * parts.competition +
    WEIGHTS.us * parts.us +
    WEIGHTS.recency * parts.recency;

  return {
    winningScore: Math.round(total * 100),
    suggestedPrice: suggested,
    shipping,
    profit: Math.round(profit * 100) / 100,
    margin: Math.round(margin * 1000) / 1000,
    competition: competitionLevel(input.listedNum),
    parts: {
      margin: Math.round(parts.margin * 100) / 100,
      competition: Math.round(parts.competition * 100) / 100,
      us: parts.us,
      recency: Math.round(parts.recency * 100) / 100,
    },
  };
}

/**
 * What similar items sell for on eBay right now (average of the top active
 * fixed-price listings, item + shipping) and what that means for this product:
 *   good    — the market is at or above AutoPilot's suggested price;
 *   low     — between break-even and the suggested price: sellable, but only
 *             cheaper than planned, so the Winning Score is cut;
 *   too_low — below break-even (cost + shipping + eBay fees): every sale at
 *             market price loses money, so the product is dropped.
 */
export type MarketInfo = {
  status: "good" | "low" | "too_low";
  average: number;
  /** Listings averaged. */
  count: number;
  /** The eBay search used. */
  query: string;
  /** The lowest price that doesn't lose money after cost, shipping and eBay fees. */
  breakeven: number;
  /** Net profit per sale if listed at the market average. */
  profitAtMarket: number;
  /** Winning Score before the market adjustment. */
  scoreBefore: number;
};

/** Break-even list price: cost + shipping + eBay's fixed and final value fees. */
export function breakevenPrice(cost: number, shipping: number) {
  return Math.round(((cost + shipping + EBAY_FIXED_FEE) / (1 - EBAY_FINAL_VALUE_FEE)) * 100) / 100;
}

/** At break-even a "low" product keeps this share of its score, rising to all of it at the suggested price. */
const LOW_MARKET_FLOOR = 0.4;

export function marketAdjustment(
  input: { cost: number; shipping: number; suggestedPrice: number; winningScore: number },
  market: { average: number; count: number; query: string },
): { winningScore: number; market: MarketInfo } {
  const breakeven = breakevenPrice(input.cost, input.shipping);
  const base = {
    average: Math.round(market.average * 100) / 100,
    count: market.count,
    query: market.query,
    breakeven,
    profitAtMarket: netProfitFor(market.average, input.cost, input.shipping),
    scoreBefore: input.winningScore,
  };
  if (market.average < breakeven) {
    return { winningScore: 0, market: { ...base, status: "too_low" } };
  }
  if (market.average < input.suggestedPrice) {
    const room = (market.average - breakeven) / Math.max(0.01, input.suggestedPrice - breakeven);
    const factor = LOW_MARKET_FLOOR + (1 - LOW_MARKET_FLOOR) * clamp01(room);
    return { winningScore: Math.round(input.winningScore * factor), market: { ...base, status: "low" } };
  }
  return { winningScore: input.winningScore, market: { ...base, status: "good" } };
}

/** CJ sends dates as ISO strings, "YYYY-MM-DD HH:mm:ss", or epoch milliseconds. */
export function parseCjDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const raw = typeof value === "number" ? value : String(value).trim();
  const date =
    typeof raw === "number" || /^\d{12,14}$/.test(raw)
      ? new Date(Number(raw))
      : new Date(String(raw).replace(" ", "T"));
  const time = date.getTime();
  // Ignore nonsense (before CJ existed or in the future).
  return Number.isFinite(time) && time > Date.UTC(2014, 0, 1) && time <= Date.now() + 86_400_000 ? date : null;
}
