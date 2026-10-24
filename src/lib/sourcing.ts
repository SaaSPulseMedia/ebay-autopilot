import "server-only";

import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { listings, sourcingCandidates, sourcingSettings, users } from "@/db/schema";
import { cjCategoryScope, fetchCjListingData, getWinningProducts } from "@/lib/cj/catalog";
import { getMarketPrice, marketPriceWarning } from "@/lib/ebay/market-price";
import { planEbayListing } from "@/lib/ebay/publish-with-resolver";
import { planLimits } from "@/lib/limits";
import { connectedAccessToken } from "@/lib/listing-pipeline";
import { resolveListingPrice } from "@/lib/market-pricing";
import { findNiche } from "@/lib/niches";
import { MIN_PROFIT, netProfitFor } from "@/lib/pricing";
import { dismissProduct, dismissedPids } from "@/lib/seen-products";
import { getListingDefaults } from "@/lib/seller-settings";
import type { RejectReason } from "@/lib/sourcing-reasons";
import { listingVariants, productSku } from "@/lib/variants";
import { screenVero } from "@/lib/vero";

/**
 * The sourcing checker: finds CJ products in the seller's niches and checks
 * each one with the same rules a real listing goes through, so the seller
 * only ever sees products that will publish:
 *  1. Find: when fewer than QUEUE_MIN products are waiting, CJ is asked for
 *     products in a few of one niche's own categories (getWinningProducts),
 *     lightly pre-filtered by seller count and estimated profit, and the new
 *     ones are queued by Winning Score. Products already checked, listed or
 *     dismissed are left out.
 *  2. Check, best first, while time allows: CJ details and real US shipping
 *     (fetchCjListingData), brand risk (screenVero), the seller's pricing rule
 *     with the profit floor (resolveListingPrice), the publish-time market guard
 *     (marketPriceWarning), and, when an eBay store is connected, a dry run of
 *     eBay's category, variants and sizes (planEbayListing).
 *  3. Each product ends "ready" or "rejected" with its reason, so the seller
 *     can see what was checked and why products were turned down.
 * Runs hourly from /api/cron/source and on demand from /api/sourcing/run.
 * Nothing is imported or listed here.
 */

/** Fewer products waiting than this triggers a search for more. */
const QUEUE_MIN = 10;
/** CJ categories of the niche asked per search (2 CJ calls each, ~1.1 s apart). */
const FIND_CATEGORIES = 3;
/** Products queued per search, best Winning Score first. */
const FIND_LIMIT = 40;
/** Pre-filter: CJ products listed by more sellers than this are skipped. */
const MAX_SELLERS = 50;
/**
 * Pre-filter: estimated profit (Winning Score's shipping estimate) below this
 * is skipped. Lower than the MIN_PROFIT floor on purpose: the real check decides.
 */
const MIN_ESTIMATED_PROFIT = 2;
/** One check takes ~6–8 s (5 CJ calls plus eBay); none starts with less time than this left. */
const CHECK_BUDGET_MS = 10_000;
/** Ready products are re-checked after this long (CJ cost, shipping and eBay prices move). */
const RECHECK_READY_MS = 3 * 24 * 60 * 60 * 1000;
/** Rejected products can be queued again by a later search after this long. */
const RETRY_REJECTED_MS = 30 * 24 * 60 * 60 * 1000;
/** A second run for the same seller doesn't start while one may still be going. */
const RUN_LOCK_MS = 55_000;
/**
 * When the variant rules last changed (kids' sizes by height, non-size
 * options listed as "Style"): products turned down for variants before then
 * are checked again under the new rules instead of waiting RETRY_REJECTED_MS.
 */
const VARIANT_RULES_CHANGED = new Date("2026-10-24T17:00:00Z");

export type SourcingSettings = { niches: string[]; enabled: boolean; lastRunAt: Date | null };

export async function getSourcingSettings(userId: number): Promise<SourcingSettings> {
  const [row] = await db.select().from(sourcingSettings).where(eq(sourcingSettings.userId, userId)).limit(1);
  return { niches: row?.niches ?? [], enabled: row?.enabled ?? true, lastRunAt: row?.lastRunAt ?? null };
}

/** Saves the niches (only known ones) and on/off switch. */
export async function saveSourcingSettings(userId: number, input: { niches: unknown; enabled: unknown }) {
  const niches = Array.isArray(input.niches)
    ? [...new Set(input.niches.filter((n): n is string => typeof n === "string" && findNiche(n) !== null))]
    : [];
  const enabled = input.enabled !== false;
  await db
    .insert(sourcingSettings)
    .values({ userId, niches, enabled })
    .onConflictDoUpdate({ target: sourcingSettings.userId, set: { niches, enabled, updatedAt: new Date() } });
  return { niches, enabled };
}

/** One product's check result. "error" (CJ unreachable, …) leaves it queued for the next run. */
type CheckOutcome =
  | { status: "ready"; values: Partial<typeof sourcingCandidates.$inferInsert> }
  | { status: "rejected"; reason: RejectReason; detail: string; values?: Partial<typeof sourcingCandidates.$inferInsert> }
  | { status: "error"; detail: string };

type CheckContext = {
  userId: number;
  defaults: Awaited<ReturnType<typeof getListingDefaults>>;
  maxVariants: number;
  ebayConnected: boolean;
};

const money = (n: number) => n.toFixed(2);

async function checkProduct(ctx: CheckContext, pid: string): Promise<CheckOutcome> {
  const fetched = await fetchCjListingData(pid);
  if (!fetched.ok) {
    if (fetched.status === 422 && /no shipping method/i.test(fetched.error)) {
      return { status: "rejected", reason: "no_shipping", detail: fetched.error };
    }
    if (fetched.status === 404 || fetched.status === 422) return { status: "rejected", reason: "bad_data", detail: fetched.error };
    return { status: "error", detail: fetched.error };
  }
  const { draft, shipping, suggested } = fetched.data;
  const seen = {
    title: draft.title,
    imageUrl: draft.images[0] ?? null,
    cost: money(draft.supplierPrice),
    shipping: money(shipping),
  };

  const vero = screenVero(draft.title, draft.category);
  if (vero.risk === "high") return { status: "rejected", reason: "brand", detail: vero.reason, values: seen };

  const price = await resolveListingPrice(ctx.defaults, {
    title: draft.title,
    supplierPrice: draft.supplierPrice,
    shippingCost: shipping,
    suggestedPrice: suggested,
  });
  const profit = netProfitFor(price.listPrice, draft.supplierPrice, shipping, ctx.defaults.adRatePct);
  const priced = { ...seen, listPrice: money(price.listPrice), profit: money(profit), market: price.market != null ? money(price.market) : null };
  if (profit < MIN_PROFIT) {
    return {
      status: "rejected",
      reason: "low_profit",
      detail: `Only $${profit.toFixed(2)} profit after real shipping and eBay fees.`,
      values: priced,
    };
  }
  if (price.rule === "low") {
    const why = price.reason ?? "the price eBay buyers pay is too low";
    return { status: "rejected", reason: "too_expensive", detail: `${why.charAt(0).toUpperCase()}${why.slice(1)}.`, values: priced };
  }

  // The publish-time Market Guard: a listing it would block never counts as ready.
  const warning = await marketPriceWarning(draft.title, price.listPrice);
  const lookup = await getMarketPrice(draft.title);
  const market = lookup.ok && lookup.market ? money(lookup.market.average) : priced.market;
  if (warning) return { status: "rejected", reason: "too_expensive", detail: warning, values: { ...priced, market } };

  // eBay's category, variants and sizes, as the publish would send them. Needs the seller's eBay store.
  const variants = listingVariants({
    sku: productSku(draft.title),
    listPrice: price.listPrice,
    supplierPrice: draft.supplierPrice,
    quantity: ctx.defaults.quantityPerVariant,
    supplierVariants: draft.variants,
    maxVariants: ctx.maxVariants,
  });
  let ebayCategory: string | null = null;
  if (ctx.ebayConnected) {
    const plan = await planEbayListing({
      userId: ctx.userId,
      sku: productSku(draft.title),
      title: draft.title,
      variations: variants.length > 1 ? variants : undefined,
    });
    if (!plan.ok) return { status: "rejected", reason: "variants", detail: plan.error, values: { ...priced, market } };
    ebayCategory = plan.categoryPath;
  }

  return { status: "ready", values: { ...priced, market, variantCount: variants.length, ebayCategory } };
}

/** CJ product ids the seller has already listed (not ended), from listings.payload.externalId ("cj-<pid>"). */
async function listedPids(userId: number) {
  const rows = await db
    .select({ externalId: sql<string | null>`${listings.payload}->>'externalId'` })
    .from(listings)
    .where(and(eq(listings.userId, userId), ne(listings.status, "ended")));
  return new Set(rows.map((r) => r.externalId ?? "").filter((id) => id.startsWith("cj-")).map((id) => id.slice(3)));
}

/** Queues fresh CJ products from a niche (a few of its CJ categories at random). Returns how many were queued. */
async function findProducts(userId: number, nicheName: string): Promise<number> {
  const niche = findNiche(nicheName);
  if (!niche) return 0;
  const scope = await cjCategoryScope(niche.cj);
  if (!scope) {
    console.warn(`[sourcing] user ${userId} niche="${niche.name}": no matching CJ categories.`);
    return 0;
  }
  const [known, dismissed, listed] = await Promise.all([
    db
      .select({ pid: sourcingCandidates.pid, status: sourcingCandidates.status, checkedAt: sourcingCandidates.checkedAt })
      .from(sourcingCandidates)
      .where(eq(sourcingCandidates.userId, userId)),
    dismissedPids(userId),
    listedPids(userId),
  ]);
  const retryBefore = Date.now() - RETRY_REJECTED_MS;
  // Rejected long enough ago may be found again (prices and shipping change); everything else known is skipped.
  const exclude = new Set([
    ...known.filter((r) => !(r.status === "rejected" && r.checkedAt && r.checkedAt.getTime() < retryBefore)).map((r) => r.pid),
    ...dismissed,
    ...listed,
  ]);
  const ids = [...scope.ids].sort(() => Math.random() - 0.5).slice(0, FIND_CATEGORIES);
  const found = await getWinningProducts(userId, {
    categoryIds: ids,
    exclude,
    maxSellers: MAX_SELLERS,
    minProfit: MIN_ESTIMATED_PROFIT,
    limit: FIND_LIMIT,
  });
  if (!found.ok) {
    console.warn(`[sourcing] user ${userId} niche="${niche.name}": CJ search failed: ${found.error}`);
    return 0;
  }
  if (!found.data.length) return 0;
  await db
    .insert(sourcingCandidates)
    .values(
      found.data.map((p) => ({
        userId,
        pid: p.pid,
        niche: niche.name,
        title: p.title,
        imageUrl: p.imageUrl,
        listedNum: p.listedNum,
        score: p.winningScore,
      })),
    )
    // Only a long-ago rejection is re-queued (the exclude list keeps everything else out).
    .onConflictDoUpdate({
      target: [sourcingCandidates.userId, sourcingCandidates.pid],
      set: { status: "queued", reason: null, detail: null, foundAt: new Date(), checkedAt: null },
      setWhere: sql`${sourcingCandidates.status} = 'rejected'`,
    });
  return found.data.length;
}

export type SourcingRun = {
  ok: true;
  found: number;
  checked: number;
  ready: number;
  rejected: Partial<Record<RejectReason, number>>;
  /** Checks that failed for a passing reason (CJ unreachable…); retried next run. */
  errors: number;
  /** eBay category/variant checks were skipped because no eBay store is connected. */
  ebayChecksSkipped: boolean;
};

export type SourcingRunResult = SourcingRun | { ok: false; error: string };

/** One sourcing run for a seller: find more products if few are waiting, then check as many as time allows. */
export async function runSourcing(userId: number, deadline: number): Promise<SourcingRunResult> {
  const settings = await getSourcingSettings(userId);
  if (!settings.niches.length) return { ok: false, error: "Pick at least one niche first." };

  // Claim the run: one at a time per seller (the hourly job and "Check now" can overlap).
  const claimed = await db
    .update(sourcingSettings)
    .set({ lastRunAt: new Date() })
    .where(
      and(
        eq(sourcingSettings.userId, userId),
        or(isNull(sourcingSettings.lastRunAt), lt(sourcingSettings.lastRunAt, new Date(Date.now() - RUN_LOCK_MS))),
      ),
    )
    .returning({ userId: sourcingSettings.userId });
  if (!claimed.length) return { ok: false, error: "A check started less than a minute ago. Try again in a minute." };

  const [[user], defaults, token] = await Promise.all([
    db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1),
    getListingDefaults(userId),
    connectedAccessToken(userId),
  ]);
  const ctx: CheckContext = {
    userId,
    defaults,
    maxVariants: planLimits(user?.plan ?? "trial").maxVariants,
    ebayConnected: Boolean(token),
  };
  const run: SourcingRun = { ok: true, found: 0, checked: 0, ready: 0, rejected: {}, errors: 0, ebayChecksSkipped: !token };

  const staleReady = new Date(Date.now() - RECHECK_READY_MS);
  const waiting = () =>
    db
      .select({ pid: sourcingCandidates.pid })
      .from(sourcingCandidates)
      .where(
        and(
          eq(sourcingCandidates.userId, userId),
          or(
            eq(sourcingCandidates.status, "queued"),
            and(eq(sourcingCandidates.status, "ready"), lt(sourcingCandidates.checkedAt, staleReady)),
          ),
        ),
      )
      // Stale ready products first (keep the list honest), then the best new ones.
      .orderBy(sql`(${sourcingCandidates.status} = 'ready') desc`, desc(sourcingCandidates.score))
      .limit(20);

  await db
    .update(sourcingCandidates)
    .set({ status: "queued", reason: null, detail: null, checkedAt: null })
    .where(
      and(
        eq(sourcingCandidates.userId, userId),
        eq(sourcingCandidates.status, "rejected"),
        eq(sourcingCandidates.reason, "variants"),
        lt(sourcingCandidates.checkedAt, VARIANT_RULES_CHANGED),
      ),
    );

  let queue = await waiting();
  if (queue.length < QUEUE_MIN) {
    // Niches in random order; the next is tried when one has nothing new right now.
    const order = [...settings.niches].sort(() => Math.random() - 0.5);
    for (const niche of order) {
      if (run.found || Date.now() > deadline - 2 * CHECK_BUDGET_MS) break;
      run.found = await findProducts(userId, niche);
    }
    if (run.found) queue = await waiting();
  }

  for (const { pid } of queue) {
    if (Date.now() > deadline - CHECK_BUDGET_MS) break;
    const outcome = await checkProduct(ctx, pid);
    if (outcome.status === "error") {
      run.errors++;
      console.warn(`[sourcing] user ${userId} pid=${pid}: check failed, retried next run: ${outcome.detail}`);
      continue;
    }
    run.checked++;
    const where = and(eq(sourcingCandidates.userId, userId), eq(sourcingCandidates.pid, pid));
    if (outcome.status === "ready") {
      run.ready++;
      await db
        .update(sourcingCandidates)
        .set({ ...outcome.values, status: "ready", reason: null, detail: null, checkedAt: new Date() })
        .where(where);
    } else {
      run.rejected[outcome.reason] = (run.rejected[outcome.reason] ?? 0) + 1;
      await db
        .update(sourcingCandidates)
        .set({ ...outcome.values, status: "rejected", reason: outcome.reason, detail: outcome.detail, checkedAt: new Date() })
        .where(where);
    }
  }

  console.log(`[sourcing] user ${userId}: ${JSON.stringify(run)}`);
  return run;
}

/** Sellers the hourly job runs for: switched on, with niches, least recently run first. */
export async function sourcingSellers(): Promise<number[]> {
  const rows = await db
    .select({ userId: sourcingSettings.userId })
    .from(sourcingSettings)
    .where(and(eq(sourcingSettings.enabled, true), sql`jsonb_array_length(${sourcingSettings.niches}) > 0`))
    .orderBy(sql`${sourcingSettings.lastRunAt} asc nulls first`);
  return rows.map((r) => r.userId);
}

export type ReadyProduct = {
  pid: string;
  niche: string;
  title: string;
  imageUrl: string | null;
  cost: number;
  shipping: number;
  listPrice: number;
  profit: number;
  market: number | null;
  variantCount: number;
  ebayCategory: string | null;
  checkedAt: string | null;
};

export type TurnedDownProduct = {
  pid: string;
  title: string;
  imageUrl: string | null;
  reason: RejectReason;
  /** The seller-facing why, e.g. "Variant data invalid. Product not listed. Reason: …". */
  detail: string;
  checkedAt: string | null;
};

export type SourcingOverview = {
  settings: SourcingSettings;
  ready: ReadyProduct[];
  /** The most recent products turned down, newest first, with why. */
  turnedDown: TurnedDownProduct[];
  waiting: number;
  /** Checks finished in the last 24 hours: how many, how many ready, and why the rest were turned down. */
  last24h: { checked: number; ready: number; rejected: Partial<Record<RejectReason, number>> };
};

const toNumber = (value: string | null) => (value == null ? null : Number(value));

export async function getSourcingOverview(userId: number): Promise<SourcingOverview> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [settings, readyRows, [waitingRow], recent, rejectedRows, listed] = await Promise.all([
    getSourcingSettings(userId),
    db
      .select()
      .from(sourcingCandidates)
      .where(and(eq(sourcingCandidates.userId, userId), eq(sourcingCandidates.status, "ready")))
      .orderBy(desc(sourcingCandidates.profit))
      .limit(100),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(sourcingCandidates)
      .where(and(eq(sourcingCandidates.userId, userId), eq(sourcingCandidates.status, "queued"))),
    db
      .select({ status: sourcingCandidates.status, reason: sourcingCandidates.reason, n: sql<number>`count(*)::int` })
      .from(sourcingCandidates)
      .where(
        and(
          eq(sourcingCandidates.userId, userId),
          inArray(sourcingCandidates.status, ["ready", "rejected"]),
          gte(sourcingCandidates.checkedAt, since),
        ),
      )
      .groupBy(sourcingCandidates.status, sourcingCandidates.reason),
    db
      .select()
      .from(sourcingCandidates)
      .where(and(eq(sourcingCandidates.userId, userId), eq(sourcingCandidates.status, "rejected")))
      .orderBy(desc(sourcingCandidates.checkedAt))
      .limit(50),
    listedPids(userId),
  ]);

  const last24h: SourcingOverview["last24h"] = { checked: 0, ready: 0, rejected: {} };
  for (const row of recent) {
    last24h.checked += row.n;
    if (row.status === "ready") last24h.ready += row.n;
    else if (row.reason) last24h.rejected[row.reason as RejectReason] = (last24h.rejected[row.reason as RejectReason] ?? 0) + row.n;
  }

  return {
    settings,
    waiting: waitingRow?.n ?? 0,
    last24h,
    turnedDown: rejectedRows.map((r) => ({
      pid: r.pid,
      title: r.title,
      imageUrl: r.imageUrl,
      reason: r.reason as RejectReason,
      detail: r.detail ?? "",
      checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
    })),
    // A ready product the seller has since listed (from here or any other page) leaves the list.
    ready: readyRows.filter((r) => !listed.has(r.pid)).map((r) => ({
      pid: r.pid,
      niche: r.niche,
      title: r.title,
      imageUrl: r.imageUrl,
      cost: toNumber(r.cost) ?? 0,
      shipping: toNumber(r.shipping) ?? 0,
      listPrice: toNumber(r.listPrice) ?? 0,
      profit: toNumber(r.profit) ?? 0,
      market: toNumber(r.market),
      variantCount: r.variantCount,
      ebayCategory: r.ebayCategory,
      checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
    })),
  };
}

/** "Not for me": hides a product from this page and every other sourcing page (see dismissProduct). */
export async function dismissCandidate(userId: number, pid: string) {
  const [row] = await db
    .update(sourcingCandidates)
    .set({ status: "dismissed" })
    .where(and(eq(sourcingCandidates.userId, userId), eq(sourcingCandidates.pid, pid)))
    .returning({ niche: sourcingCandidates.niche });
  await dismissProduct(userId, pid, row?.niche ?? "");
}
