import "server-only";

import { and, count, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { generateListingCopy } from "@/lib/ai";
import { type ApiPublishContext, publishViaApi } from "@/lib/ebay/api-list";
import { isBrowserEngineAvailable, publishViaBrowser } from "@/lib/ebay/browser-list";
import { publishViaDemo } from "@/lib/ebay/demo-list";
import { getValidAccessToken } from "@/lib/ebay/tokens";
import type { ListingDraft, ListingEngine, ListingResult } from "@/lib/ebay/types";
import { nextPlanUp, planLimits, type PlanLimits } from "@/lib/limits";
import { withFooter, type ListingDefaults } from "@/lib/listing-defaults";
import { buildVariants, productSku } from "@/lib/variants";

/**
 * One place for everything every listing route shares: engine routing, the
 * plan-limit checks, and turning a product into a stored (or scheduled) listing.
 */

export type RequestedEngine = ListingEngine | "auto";

export function parseEngine(value: unknown): RequestedEngine {
  return value === "api" || value === "browser" || value === "demo" ? value : "auto";
}

/** Usable (refreshed if needed) access token for the user's connected eBay store, if any. */
export async function connectedAccessToken(userId: number): Promise<string | null> {
  return getValidAccessToken(userId);
}

/**
 * Explicit engine wins; otherwise eBay API → browser fallback → demo.
 * An engine that is merely `unavailable` falls through to the next one (its
 * reason is kept as a note); a real eBay rejection (`error`) is returned as-is,
 * so a failed listing is never quietly replaced by a demo one.
 */
export async function publishWithFallback(
  draft: ListingDraft,
  requested: RequestedEngine,
  accessToken: string | null,
  context?: ApiPublishContext,
): Promise<ListingResult> {
  const order: ListingEngine[] =
    requested === "auto"
      ? [accessToken ? "api" : "demo", isBrowserEngineAvailable() ? "browser" : "demo", "demo"]
      : [requested, "demo"];

  let apiNote: string | null = null;
  for (const engine of order) {
    const result =
      engine === "api"
        ? await publishViaApi(draft, accessToken, context)
        : engine === "browser"
          ? await publishViaBrowser(draft)
          : await publishViaDemo(draft);
    if (result.status === "published" || result.status === "queued") {
      return apiNote ? { ...result, message: `${result.message} Note: ${apiNote}` } : result;
    }
    if (engine === "api" && result.status === "error") return result;
    if (engine === "api" && accessToken) apiNote = result.message;
  }
  return publishViaDemo(draft);
}

export function storedStatus(result: ListingResult) {
  return result.status === "published" ? "active" : result.status === "queued" ? "queued" : "draft";
}

/** Every listing that is not ended counts against the plan — including scheduled ones. */
export async function activeListingCount(userId: number) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(listings)
    .where(and(eq(listings.userId, userId), ne(listings.status, "ended")));
  return value;
}

function limitError(body: Record<string, unknown>) {
  return Response.json({ ok: false, code: "plan_limit_reached", upgrade: true, ...body }, { status: 403 });
}

/**
 * Checks batch size, active-listing capacity and (optionally) drip posting.
 * Returns a typed `plan_limit_reached` response, or null when the request fits.
 */
export async function checkPlanCapacity(
  userId: number,
  limits: PlanLimits,
  requested: number,
  options: { drip?: boolean } = {},
): Promise<Response | null> {
  const upgrade = nextPlanUp(limits.planId);
  const upgradeLimits = upgrade ? planLimits(upgrade.id) : null;
  const upgradeHint = upgrade && upgradeLimits
    ? ` Upgrade to ${upgrade.name} for ${upgradeLimits.activeListings.toLocaleString("en-US")} active listings.`
    : "";
  const base = { plan: limits.planName, upgradePlan: upgrade?.name ?? null };

  if (options.drip && !limits.dripPosting) {
    return limitError({
      ...base,
      limitType: "drip_posting",
      upgradePlan: "Pro",
      error: "Drip posting is included in Pro and Business. Turn it off to publish now, or upgrade to schedule batches.",
    });
  }

  if (requested > limits.batchSize) {
    return Response.json(
      {
        ok: false,
        code: "plan_limit_reached",
        limitType: "batch_size",
        upgrade: false,
        error: `You can list up to ${limits.batchSize} products per run. You selected ${requested} — split them into smaller runs.`,
      },
      { status: 403 },
    );
  }

  const activeCount = await activeListingCount(userId);
  const remaining = Math.max(0, limits.activeListings - activeCount);
  if (remaining <= 0) {
    return limitError({
      ...base,
      limitType: "active_listings",
      current: activeCount,
      max: limits.activeListings,
      error: `You have reached your ${limits.planName} limit of ${limits.activeListings} active listings (${activeCount}/${limits.activeListings} used). End some listings or upgrade to keep publishing.${upgradeHint}`,
    });
  }
  if (requested > remaining) {
    return limitError({
      ...base,
      limitType: "active_listings",
      current: activeCount,
      max: limits.activeListings,
      remaining,
      error: `You have room for ${remaining} more active listing${remaining === 1 ? "" : "s"} on ${limits.planName} (${activeCount}/${limits.activeListings} used). You selected ${requested}.${upgradeHint}`,
    });
  }
  return null;
}

export type ListingSource = {
  title: string;
  category?: string;
  supplierPrice: number;
  listPrice: number;
  sourceUrl: string | null;
  imageUrl: string | null;
};

export type ItemResult = { title: string; status: string; variants: number; message: string };

/**
 * AI copy → variants → publish now, or store as "scheduled" for drip posting.
 * Scheduled listings keep the requested engine in the payload for the release job.
 */
export async function createListing(args: {
  userId: number;
  limits: PlanLimits;
  defaults: ListingDefaults;
  source: ListingSource;
  requested: RequestedEngine;
  accessToken: string | null;
  drip: boolean;
  batchId: string;
}): Promise<ItemResult> {
  const { source, limits, defaults } = args;
  const copy = await generateListingCopy({
    title: source.title,
    category: source.category,
    supplierPrice: source.supplierPrice,
    listPrice: source.listPrice,
  });
  const variants = buildVariants(source.title, source.category ?? "", source.listPrice, limits.maxVariants).map(
    (variant) => ({ ...variant, quantity: defaults.quantityPerVariant }),
  );

  const sku = productSku(source.title);
  const draft: ListingDraft = {
    title: copy.title,
    description: withFooter(copy.description, defaults.descriptionFooter),
    listPrice: source.listPrice,
    supplierPrice: source.supplierPrice,
    sourceUrl: source.sourceUrl,
    imageUrl: source.imageUrl,
    quantity: variants.reduce((sum, variant) => sum + variant.quantity, 0),
  };

  const outcome = args.drip
    ? null
    : await publishWithFallback(draft, args.requested, args.accessToken, { userId: args.userId, sku });

  await db.insert(listings).values({
    userId: args.userId,
    title: draft.title,
    description: draft.description,
    sourceUrl: draft.sourceUrl,
    imageUrl: draft.imageUrl,
    supplierPrice: draft.supplierPrice.toFixed(2),
    listPrice: draft.listPrice.toFixed(2),
    engine: outcome?.engine ?? (args.requested === "auto" ? "demo" : args.requested),
    status: outcome ? storedStatus(outcome) : "scheduled",
    ebayItemId: outcome?.itemId ?? null,
    aiGenerated: copy.source === "claude",
    variantCount: variants.length,
    batchId: args.batchId,
    payload: {
      ...draft,
      sku,
      variants,
      itemSpecifics: copy.itemSpecifics,
      bullets: copy.bullets,
      requestedEngine: args.requested,
      handlingDays: defaults.handlingDays,
      adRatePct: defaults.adRatePct,
    },
  });

  return {
    title: draft.title,
    status: outcome?.status ?? "scheduled",
    variants: variants.length,
    // "Note:" makes the batch summary show the reason for a failed listing.
    message:
      outcome?.status === "error"
        ? `Not listed. Note: ${outcome.message}`
        : (outcome?.message ?? "Scheduled for drip posting."),
  };
}

/** Runs async work in small concurrent chunks so a large batch does not stall. */
export async function inChunks<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  }
  return out;
}

/** Response body shared by the catalog bulk route and the paste-links route. */
export function summarizeBatch(batchId: string, requested: number, results: ItemResult[]) {
  const ok = results.filter((row) => ["published", "queued", "scheduled"].includes(row.status));
  const failed = results.filter((row) => row.status === "error");
  // Every attempted item was rejected by eBay: report the batch as failed, not "complete".
  if (failed.length && !ok.length) {
    return {
      ok: false,
      code: "ebay_publish_failed",
      error: `eBay rejected ${failed.length === 1 ? "the listing" : `all ${failed.length} listings`}: ${failed[0].message.replace(/^Not listed\. Note: /, "")}`,
      batchId,
      requested,
      failed: failed.length,
      results,
    };
  }
  return {
    ok: true,
    batchId,
    requested,
    published: ok.filter((row) => row.status !== "scheduled").length,
    scheduled: ok.filter((row) => row.status === "scheduled").length,
    blocked: results.filter((row) => row.status === "blocked").length,
    skipped: results.filter((row) => row.status === "skipped").length,
    failed: failed.length,
    variantTotal: ok.reduce((sum, row) => sum + row.variants, 0),
    results,
  };
}
