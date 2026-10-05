import { randomUUID } from "node:crypto";

import { db } from "@/db";
import { ebayAccounts, listings } from "@/db/schema";
import { generateListingCopy } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { publishViaApi } from "@/lib/ebay/api-list";
import { isBrowserEngineAvailable, publishViaBrowser } from "@/lib/ebay/browser-list";
import { publishViaDemo } from "@/lib/ebay/demo-list";
import type { ListingDraft, ListingEngine, ListingResult } from "@/lib/ebay/types";
import { nextPlanUp, planLimits } from "@/lib/limits";
import { getCatalog } from "@/lib/suppliers";
import { buildVariants } from "@/lib/variants";
import { and, count, eq, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseEngine(value: unknown): ListingEngine | "auto" {
  return value === "api" || value === "browser" || value === "demo" ? value : "auto";
}

async function publish(
  draft: ListingDraft,
  requested: ListingEngine | "auto",
  accessToken: string | null,
): Promise<ListingResult> {
  const order: ListingEngine[] =
    requested === "auto"
      ? [accessToken ? "api" : "demo", isBrowserEngineAvailable() ? "browser" : "demo", "demo"]
      : [requested, "demo"];

  let result: ListingResult | null = null;
  for (const engine of order) {
    if (engine === "api") result = await publishViaApi(draft, accessToken);
    else if (engine === "browser") result = await publishViaBrowser(draft);
    else result = await publishViaDemo(draft);
    if (result.status === "published" || result.status === "queued") break;
  }
  return result ?? publishViaDemo(draft);
}

/** One-click bulk listing: the core of the product. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { externalIds?: unknown; engine?: unknown };
  const ids = Array.isArray(body.externalIds) ? body.externalIds.filter((id): id is string => typeof id === "string") : [];
  if (!ids.length) {
    return Response.json({ ok: false, error: "Select at least one product to list." }, { status: 400 });
  }

  const limits = planLimits(user.plan);
  const upgrade = nextPlanUp(limits.planId);
  const upgradeHint = upgrade
    ? ` Upgrade to ${upgrade.name} for ${upgrade.bulkLimit.toLowerCase()}.`
    : "";

  if (ids.length > limits.batchSize) {
    return Response.json(
      {
        ok: false,
        code: "plan_limit_reached",
        limitType: "batch_size",
        error: `Your ${limits.planName} plan lists up to ${limits.batchSize} products per run. You selected ${ids.length}.${upgradeHint}`,
        upgrade: true,
        batchSize: limits.batchSize,
        selected: ids.length,
        plan: limits.planName,
        upgradePlan: upgrade ? upgrade.name : null,
      },
      { status: 403 },
    );
  }

  // Active-listing cap: count non-ended listings per user
  const [{ count: activeCount }] = await db
    .select({ count: count() })
    .from(listings)
    .where(and(eq(listings.userId, user.id), ne(listings.status, "ended")));

  const remaining = Math.max(0, limits.activeListings - activeCount);
  if (remaining <= 0) {
    return Response.json(
      {
        ok: false,
        code: "plan_limit_reached",
        limitType: "active_listings",
        error: `You have reached your ${limits.planName} limit of ${limits.activeListings} active listings (${activeCount}/${limits.activeListings} used). End some listings or upgrade your plan to keep publishing.${upgradeHint}`,
        upgrade: true,
        current: activeCount,
        max: limits.activeListings,
        plan: limits.planName,
        upgradePlan: upgrade ? upgrade.name : null,
      },
      { status: 403 },
    );
  }
  if (ids.length > remaining) {
    return Response.json(
      {
        ok: false,
        code: "plan_limit_reached",
        limitType: "active_listings",
        error: `You have room for ${remaining} more active listing${remaining === 1 ? "" : "s"} on ${limits.planName} (${activeCount}/${limits.activeListings} used). You selected ${ids.length}.${upgradeHint}`,
        upgrade: true,
        remaining,
        current: activeCount,
        max: limits.activeListings,
        selected: ids.length,
        plan: limits.planName,
        upgradePlan: upgrade ? upgrade.name : null,
      },
      { status: 403 },
    );
  }

  const catalog = await getCatalog(200);
  const found = catalog.filter((product) => ids.includes(product.externalId));
  if (!found.length) {
    return Response.json({ ok: false, error: "None of those products are in the catalog." }, { status: 404 });
  }

  // Per-item VeRO gate: brand-name products are skipped, the rest of the batch still publishes.
  const blocked = found.filter((product) => product.veroRisk === "high");
  const selected = found.filter((product) => product.veroRisk !== "high");

  const [account] = await db
    .select()
    .from(ebayAccounts)
    .where(and(eq(ebayAccounts.userId, user.id), eq(ebayAccounts.mode, "oauth")))
    .limit(1);

  const requested = parseEngine(body.engine);
  const batchId = randomUUID();
  const results: { title: string; status: string; variants: number; message: string }[] = blocked.map((product) => ({
    title: product.title,
    status: "blocked",
    variants: 0,
    message: `Skipped to protect your eBay account: ${product.veroReason}`,
  }));

  // Process in small concurrent chunks so a large batch does not stall on AI calls.
  const CHUNK = 5;
  for (let i = 0; i < selected.length; i += CHUNK) {
    const chunk = selected.slice(i, i + CHUNK);
    const settled = await Promise.all(
      chunk.map(async (product) => {
        const copy = await generateListingCopy({
          title: product.title,
          category: product.category,
          supplierPrice: product.supplierPrice,
          listPrice: product.suggestedPrice,
        });
        const variants = buildVariants(product.title, product.category, product.suggestedPrice, limits.maxVariants);

        const draft: ListingDraft = {
          title: copy.title,
          description: copy.description,
          listPrice: product.suggestedPrice,
          supplierPrice: product.supplierPrice,
          sourceUrl: product.supplierUrl,
          imageUrl: product.imageUrl,
          quantity: variants.reduce((sum, variant) => sum + variant.quantity, 0),
        };

        const outcome = await publish(draft, requested, account?.accessToken ?? null);

        await db.insert(listings).values({
          userId: user.id,
          title: draft.title,
          description: draft.description,
          sourceUrl: draft.sourceUrl,
          imageUrl: draft.imageUrl,
          supplierPrice: draft.supplierPrice.toFixed(2),
          listPrice: draft.listPrice.toFixed(2),
          engine: outcome.engine,
          status: outcome.status === "published" ? "active" : outcome.status === "queued" ? "queued" : "draft",
          ebayItemId: outcome.itemId,
          aiGenerated: copy.source === "claude",
          variantCount: variants.length,
          batchId,
          payload: { ...draft, variants, itemSpecifics: copy.itemSpecifics, bullets: copy.bullets },
        });

        return {
          title: draft.title,
          status: outcome.status,
          variants: variants.length,
          message: outcome.message,
        };
      }),
    );
    results.push(...settled);
  }

  const published = results.filter((row) => row.status === "published" || row.status === "queued").length;
  const variantTotal = results.reduce((sum, row) => sum + row.variants, 0);

  return Response.json({
    ok: true,
    batchId,
    blocked: blocked.length,
    requested: found.length,
    published,
    variantTotal,
    results,
  });
}
