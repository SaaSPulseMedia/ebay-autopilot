import "server-only";

import { isEbayConfigured } from "./oauth";
import { type CatalogProductForPublish, publishWithResolver } from "./publish-with-resolver";
import type { ListingDraft, ListingResult } from "./types";

/**
 * Official eBay Sell (Inventory) API engine.
 *
 * Publishing goes through publishWithResolver (category + item specifics +
 * inventory item → offer → publish). It runs only when the caller supplies
 * the seller's user id and SKU and the draft has an image and a price;
 * otherwise it reports `unavailable` and the pipeline falls back to demo mode.
 * A rejection from eBay comes back as `error`, which is not retried in demo.
 */
export type ApiPublishContext = { userId: number; sku: string };

function unavailable(draft: ListingDraft, message: string): ListingResult {
  return { engine: "api", status: "unavailable", message, itemId: null, title: draft.title };
}

function missingFields(draft: ListingDraft, context?: ApiPublishContext) {
  const missing: string[] = [];
  if (!context?.userId || !context.sku) missing.push("seller context");
  if (!draft.title) missing.push("a title");
  if (!draft.imageUrl) missing.push("a product image");
  if (!(draft.listPrice > 0)) missing.push("a price");
  return missing;
}

function toCatalogProduct(draft: ListingDraft, context?: ApiPublishContext): CatalogProductForPublish | null {
  if (!context || !draft.imageUrl || missingFields(draft, context).length) return null;
  return {
    userId: context.userId,
    sku: context.sku,
    title: draft.title,
    description: draft.description,
    imageUrls: [draft.imageUrl],
    price: draft.listPrice,
    quantity: draft.quantity && draft.quantity > 0 ? draft.quantity : 1,
  };
}

export async function publishViaApi(
  draft: ListingDraft,
  accessToken?: string | null,
  context?: ApiPublishContext,
): Promise<ListingResult> {
  if (!isEbayConfigured() || !accessToken) {
    return unavailable(draft, "No eBay store connected. Connect your store in Settings.");
  }

  const product = toCatalogProduct(draft, context);
  if (!product) {
    const missing = missingFields(draft, context);
    console.warn(`[ebay-publish] missing-input for "${draft.title}" (${missing.join(", ")}); falling back to demo.`);
    return unavailable(draft, `Not sent to eBay: the listing needs ${missing.join(" and ")}.`);
  }

  const result = await publishWithResolver(product);
  if (!result.ok) {
    return { engine: "api", status: "error", message: `eBay ${result.step} step failed: ${result.error}`, itemId: null, title: draft.title };
  }
  return {
    engine: "api",
    status: "published",
    message: result.usedFallbackCategory
      ? `Published to eBay under ${result.categoryPath} (category could not be matched).`
      : `Published to eBay in ${result.categoryPath}.`,
    itemId: result.listingId,
    title: draft.title,
  };
}
