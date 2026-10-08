import "server-only";

import { ensureMerchantLocation, fetchBusinessPolicies } from "@/lib/ebay/account";
import { type EbayError, ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";

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

  // 2. Offer. eBay allows one offer per SKU and marketplace, so if an earlier
  // run already created it, reuse that offer (updated to today's details)
  // instead of failing — never delete and recreate it.
  const offerBody = JSON.stringify({
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
  });
  const offer = await ebayFetch<{ offerId?: string }>("/sell/inventory/v1/offer", token, {
    method: "POST",
    body: offerBody,
  });
  let offerId = offer.offerId;
  if (!offerId && isOfferAlreadyExists(offer.errors)) {
    offerId = offerIdFromErrors(offer.errors) ?? (await findExistingOffer(token, input.sku))?.offerId;
    console.warn(
      `[ebay-offer] sku ${input.sku}: offer already exists; fallback=reuse offerId=${offerId ?? "not found"}. eBay said:`,
      JSON.stringify(offer.errors),
    );
    if (offerId) {
      const updated = await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, token, {
        method: "PUT",
        body: offerBody,
      });
      if (updated.errors?.length) {
        console.error(`[ebay-offer] sku ${input.sku}: updating existing offer ${offerId} failed:`, JSON.stringify(updated.errors));
        return { ok: false, step: "offer", error: ebayErrorMessage(updated, "eBay would not update the existing offer.") };
      }
    }
  } else if (!offerId) {
    console.error(`[ebay-offer] sku ${input.sku}: create offer failed (no fallback):`, JSON.stringify(offer.errors));
  }
  if (!offerId) {
    return { ok: false, step: "offer", error: ebayErrorMessage(offer, "eBay did not return an offer ID.") };
  }

  // 3. Publish. If eBay refuses because the offer is already live, the existing
  // listing is the result we wanted.
  const published = await ebayFetch<{ listingId?: string }>(
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    token,
    { method: "POST" },
  );
  let listingId = published.listingId;
  if (!listingId) {
    const existing = await getOffer(token, offerId);
    if (existing?.status === "PUBLISHED" && existing.listingId) {
      listingId = existing.listingId;
      console.warn(
        `[ebay-offer] sku ${input.sku}: offer ${offerId} already published; fallback=existing listing ${listingId}. eBay said:`,
        JSON.stringify(published.errors),
      );
    } else {
      console.error(
        `[ebay-offer] sku ${input.sku}: publish of offer ${offerId} failed (offer status ${existing?.status ?? "unknown"}):`,
        JSON.stringify(published.errors),
      );
      return { ok: false, step: "publish", error: ebayErrorMessage(published, "eBay did not return a listing ID.") };
    }
  }

  return { ok: true, offerId, listingId };
}

type OfferSummary = { offerId?: string; status?: string; listing?: { listingId?: string } };
type ErrorWithParameters = EbayError & { parameters?: { name?: string; value?: string }[] };

/** "Offer entity already exists". eBay's 25002 is a generic user error, so match on the text too. */
function isOfferAlreadyExists(errors: EbayError[] | undefined) {
  return (errors ?? []).some((e) => /offer (entity )?already exists/i.test(`${e.message ?? ""} ${e.longMessage ?? ""}`));
}

/** eBay usually names the existing offer in the error's parameters. */
function offerIdFromErrors(errors: EbayError[] | undefined) {
  for (const e of (errors ?? []) as ErrorWithParameters[]) {
    const id = e.parameters?.find((p) => p.name === "offerId")?.value;
    if (id) return id;
  }
  return undefined;
}

async function findExistingOffer(token: string, sku: string) {
  const res = await ebayFetch<{ offers?: OfferSummary[] }>(
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_US`,
    token,
  );
  if (res.errors?.length) {
    console.error(`[ebay-offer] sku ${sku}: looking up existing offer failed:`, JSON.stringify(res.errors));
    return null;
  }
  const offer = res.offers?.find((o) => o.offerId);
  return offer ? { offerId: offer.offerId as string, status: offer.status, listingId: offer.listing?.listingId } : null;
}

async function getOffer(token: string, offerId: string) {
  const res = await ebayFetch<OfferSummary>(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, token);
  if (res.errors?.length) return null;
  return { status: res.status, listingId: res.listing?.listingId };
}

/** The seller's existing EBAY_US offer ID for a SKU, or null if there is none. */
export async function getExistingOfferId(userId: number, sku: string): Promise<string | null> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return null;
  return (await findExistingOffer(token, sku))?.offerId ?? null;
}
