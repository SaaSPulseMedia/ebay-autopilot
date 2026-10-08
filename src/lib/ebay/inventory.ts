import "server-only";

import { ensureMerchantLocation, fetchBusinessPolicies } from "@/lib/ebay/account";
import { ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";

export type PublishInput = {
  userId: number;
  sku: string;
  title: string;
  description: string;
  imageUrls: string[];
  price: number;
  quantity: number;
  categoryId: string;
  brand?: string;
  mpn?: string;
  aspects?: Record<string, string[]>;
  /** eBay ConditionEnum, e.g. "NEW" (default) or "USED_EXCELLENT". */
  condition?: string;
};

export type PublishResult =
  | { ok: true; offerId: string; listingId: string }
  | { ok: false; step: "setup" | "item" | "offer" | "publish"; error: string; details?: unknown };

/**
 * Publishes one fixed-price listing through the Inventory API:
 * inventory item → offer → publish. Each step reports where it stopped.
 */
export async function publishListing(input: PublishInput): Promise<PublishResult> {
  const policies = await fetchBusinessPolicies(input.userId);
  if (!policies.fulfillmentPolicyId || !policies.paymentPolicyId || !policies.returnPolicyId) {
    return {
      ok: false,
      step: "setup",
      error:
        "Your eBay account is missing business policies. Create a shipping, payment and return policy in eBay Seller Hub, then try again.",
    };
  }

  const location = await ensureMerchantLocation(input.userId);
  if (!location.ok) {
    return {
      ok: false,
      step: "setup",
      error: `Could not create a merchant location on eBay: ${location.error}`,
      details: location.details,
    };
  }
  const merchantLocationKey = location.locationKey;

  const token = await getAccessTokenForUser(input.userId);
  if (!token) return { ok: false, step: "setup", error: "No eBay store connected. Connect your store in Settings." };

  const sku = encodeURIComponent(input.sku);

  // 1. Inventory item (PUT is an upsert keyed by SKU).
  const item = await ebayFetch(`/sell/inventory/v1/inventory_item/${sku}`, token, {
    method: "PUT",
    body: JSON.stringify({
      availability: { shipToLocationAvailability: { quantity: input.quantity } },
      condition: input.condition ?? "NEW",
      product: {
        title: input.title.slice(0, 80),
        description: input.description,
        imageUrls: input.imageUrls.slice(0, 24),
        ...(input.aspects ? { aspects: input.aspects } : {}),
        ...(input.brand ? { brand: input.brand } : {}),
        ...(input.mpn ? { mpn: input.mpn } : {}),
      },
    }),
  });
  if (item.errors?.length) {
    return { ok: false, step: "item", error: ebayErrorMessage(item, "eBay rejected the inventory item.") };
  }

  // 2. Offer.
  const offer = await ebayFetch<{ offerId?: string }>("/sell/inventory/v1/offer", token, {
    method: "POST",
    body: JSON.stringify({
      sku: input.sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: input.quantity,
      categoryId: input.categoryId,
      listingDescription: input.description,
      pricingSummary: { price: { value: input.price.toFixed(2), currency: "USD" } },
      listingPolicies: {
        fulfillmentPolicyId: policies.fulfillmentPolicyId,
        paymentPolicyId: policies.paymentPolicyId,
        returnPolicyId: policies.returnPolicyId,
      },
      merchantLocationKey,
    }),
  });
  const offerId = offer.offerId;
  if (!offerId) {
    return { ok: false, step: "offer", error: ebayErrorMessage(offer, "eBay did not return an offer ID.") };
  }

  // 3. Publish.
  const published = await ebayFetch<{ listingId?: string }>(
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    token,
    { method: "POST" },
  );
  const listingId = published.listingId;
  if (!listingId) {
    return { ok: false, step: "publish", error: ebayErrorMessage(published, "eBay did not return a listing ID.") };
  }

  return { ok: true, offerId, listingId };
}
