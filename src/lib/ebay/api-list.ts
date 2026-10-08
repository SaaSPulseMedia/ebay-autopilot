import "server-only";

import { isEbayConfigured } from "./oauth";
import { type CatalogProductForPublish, publishWithResolver } from "./publish-with-resolver";
import type { ListingDraft, ListingResult } from "./types";

/**
 * Official eBay Sell (Inventory) API engine.
 *
 * Publishing goes through publishWithResolver (category + item specifics +
 * inventory item → offer → publish). It only runs when the caller supplies
 * everything a real listing needs — the seller's user id, a SKU and images.
 * The listing pipeline doesn't pass that context yet, so for now every call
 * still reports `unavailable` and the route falls back to demo mode; it never
 * pretends a listing reached eBay.
 */
export type ApiPublishContext = { userId: number; sku: string };

function unavailable(draft: ListingDraft, message: string): ListingResult {
  return { engine: "api", status: "unavailable", message, itemId: null, title: draft.title };
}

function toCatalogProduct(draft: ListingDraft, context?: ApiPublishContext): CatalogProductForPublish | null {
  if (!context?.userId || !context.sku || !draft.title || !draft.imageUrl || !(draft.listPrice > 0)) return null;
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
    if (context) console.warn(`[ebay-publish] missing-input for "${draft.title}"; falling back to demo.`);
    return unavailable(draft, "Your store is connected, but publishing straight to eBay is still being built.");
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
