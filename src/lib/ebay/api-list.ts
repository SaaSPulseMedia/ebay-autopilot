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
  if (!listingImages(draft).length) missing.push("a product image");
  if (!(draft.listPrice > 0)) missing.push("a price");
  return missing;
}

/** Every image for the listing, primary first; just `imageUrl` when the draft has no list. */
function listingImages(draft: ListingDraft): string[] {
  const all = draft.imageUrls?.length ? draft.imageUrls : [draft.imageUrl];
  return [...new Set(all.filter((url): url is string => typeof url === "string" && url.trim() !== ""))];
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * eBay renders descriptions as HTML, so plain-text line breaks would collapse
 * the sections into one paragraph. Blank-line blocks become paragraphs, line
 * breaks become <br>, and "FEATURES:"-style headings are bolded. Text that
 * already contains HTML is sent as written.
 */
export function descriptionHtml(text: string) {
  if (/<\/?(?:p|br|div|ul|ol|li|b|strong|h[1-6]|table)\b/i.test(text)) return text;
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) =>
      `<p>${block
        .split("\n")
        .map((line) => (/^[A-Z][A-Z &'’]+:$/.test(line.trim()) ? `<strong>${escapeHtml(line.trim())}</strong>` : escapeHtml(line.trim())))
        .join("<br>")}</p>`,
    )
    .join("\n");
}

function toCatalogProduct(draft: ListingDraft, context?: ApiPublishContext): CatalogProductForPublish | null {
  if (!context || missingFields(draft, context).length) return null;
  return {
    userId: context.userId,
    sku: context.sku,
    title: draft.title,
    description: descriptionHtml(draft.description),
    imageUrls: listingImages(draft),
    price: draft.listPrice,
    quantity: draft.quantity && draft.quantity > 0 ? draft.quantity : 1,
    variations: draft.variations && draft.variations.length > 1 ? draft.variations : undefined,
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
  const where = result.usedFallbackCategory
    ? `Published to eBay under ${result.categoryPath} (category could not be matched)`
    : `Published to eBay in ${result.categoryPath}`;
  const report = result.sizes;
  const sizeCount = report && result.variations > 1 ? report.published.length : 0;
  // Size-constrained listings say how many sizes went out, and which were dropped.
  let variants =
    result.variations > 1
      ? sizeCount > 1
        ? sizeCount === result.variations
          ? ` with ${sizeCount} sizes.`
          : ` with ${result.variations} variations (${sizeCount} sizes).`
        : ` with ${result.variations} variations.`
      : result.variationFallback
        ? `. Note: published as a single listing without variations because ${result.variationFallback}.`
        : ".";
  if (report?.dropped.length) {
    variants += ` ${report.dropped.length} size${report.dropped.length === 1 ? " was" : "s were"} unmapped and dropped (${report.dropped.join(", ")}).`;
  }
  if (report?.defaulted) {
    variants += ` eBay requires a ${report.aspect} here and no supplier size fits, so the listing shows "${report.defaulted}": correct it in Seller Hub if that's wrong.`;
  }
  return {
    engine: "api",
    status: "published",
    message: `${where}${variants}`,
    variations: result.variations,
    itemId: result.listingId,
    title: draft.title,
  };
}
