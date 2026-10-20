import "server-only";

import type { WinningProduct } from "@/lib/cj/catalog";
import { getMarketPrice } from "@/lib/ebay/market-price";
import { marketAdjustment } from "@/lib/winning-score";

/** How many of the best-scored products get an eBay market check per feed. */
export const MARKET_CHECK_TOP = 30;

export type MarketCheckSummary = {
  /** Products looked up on eBay. */
  checked: number;
  /** Dropped because the eBay market price is below break-even. */
  dropped: number;
  /** Scored down because the market price is below AutoPilot's suggested price. */
  penalized: number;
  /** Not looked up because the request ran out of time. */
  skipped: number;
};

/**
 * Checks the top MARKET_CHECK_TOP products (in the order given, best first)
 * against eBay's market price: below break-even they are dropped, below the
 * suggested price their Winning Score is cut (see marketAdjustment). The rest
 * pass through unchecked. Lookups are sequential through the Browse API
 * queue; once `deadline` (epoch ms) passes, the remaining ones are skipped so
 * the request still answers in time. Returns the list re-ranked by score.
 */
export async function applyMarketCheck(
  products: WinningProduct[],
  options: { deadline?: number; top?: number } = {},
): Promise<{ products: WinningProduct[]; summary: MarketCheckSummary; droppedPids: string[] }> {
  const top = options.top ?? MARKET_CHECK_TOP;
  const summary: MarketCheckSummary = { checked: 0, dropped: 0, penalized: 0, skipped: 0 };
  const kept: WinningProduct[] = [];
  const droppedPids: string[] = [];

  for (const [index, product] of products.entries()) {
    if (index >= top) {
      kept.push(product);
      continue;
    }
    if (options.deadline && Date.now() > options.deadline) {
      summary.skipped++;
      kept.push(product);
      continue;
    }
    const lookup = await getMarketPrice(product.title);
    summary.checked++;
    if (!lookup.ok) {
      kept.push(product);
      continue;
    }
    if (!lookup.market) {
      kept.push({ ...product, market: null });
      continue;
    }
    const adjusted = marketAdjustment(
      { cost: product.price, shipping: product.shipping, suggestedPrice: product.suggestedPrice, winningScore: product.winningScore },
      lookup.market,
    );
    if (adjusted.market.status === "too_low") {
      summary.dropped++;
      droppedPids.push(product.pid);
      continue;
    }
    if (adjusted.market.status === "low") summary.penalized++;
    kept.push({ ...product, winningScore: adjusted.winningScore, market: adjusted.market });
  }

  kept.sort((a, b) => b.winningScore - a.winningScore || b.profit - a.profit);
  console.log(`[market-check] ${JSON.stringify(summary)} kept=${kept.length}`);
  return { products: kept, summary, droppedPids };
}
