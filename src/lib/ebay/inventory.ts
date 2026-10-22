import "server-only";

import { ensureFreeShippingPolicy, ensureMerchantLocation, fetchBusinessPolicies } from "@/lib/ebay/account";
import { type EbayError, ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";
import { marketPriceWarning } from "@/lib/ebay/market-price";
import { hostAllOnEbay } from "@/lib/ebay/media";
import { type PromotionResult, promoteListing } from "@/lib/ebay/promoted";
import { getListingDefaults } from "@/lib/seller-settings";
import { descriptionImageSources } from "@/lib/size-chart";

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
  /**
   * List with the seller's free-shipping policy instead of their default one
   * (the "Match eBay Market Price (Free Shipping)" rule priced it for that).
   */
  freeShipping?: boolean;
  /**
   * Two or more variants publish as one multi-variation listing (an inventory
   * item group keyed by `sku`). The caller checks the category allows them.
   */
  variations?: PublishVariation[];
};

/** One variant of a multi-variation listing; `aspects` are what it varies by, e.g. { Color: "Black" }. */
export type PublishVariation = {
  sku: string;
  aspects: Record<string, string>;
  price: number;
  quantity: number;
  imageUrl?: string | null;
};

type PublishFailure = {
  ok: false;
  step: "market" | "setup" | "variants" | "item" | "offer" | "publish";
  error: string;
  details?: unknown;
};

export type PublishResult =
  | {
      ok: true;
      offerId: string;
      listingId: string;
      variations?: number;
      /** Promoted Listings (General) outcome; the listing is live either way. */
      promotion?: PromotionResult;
    }
  | PublishFailure;

type Seller = {
  token: string;
  merchantLocationKey: string;
  listingPolicies: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string };
};

/**
 * Business policies, merchant location and access token: everything a publish
 * needs first. With `freeShipping`, the shipping policy is the seller's
 * free-shipping one (found or created, see ensureFreeShippingPolicy).
 */
async function prepareSeller(userId: number, options: { freeShipping?: boolean } = {}): Promise<{ ok: true; seller: Seller } | PublishFailure> {
  const policies = await fetchBusinessPolicies(userId);
  if (options.freeShipping && policies.paymentPolicyId && policies.returnPolicyId) {
    const { handlingDays } = await getListingDefaults(userId);
    const free = await ensureFreeShippingPolicy(userId, handlingDays);
    if (!free.ok) {
      // Priced for free shipping: listing it with paid shipping would overcharge, so stop instead.
      return { ok: false, step: "setup", error: `Couldn't set up a free shipping policy on eBay: ${free.error}` };
    }
    policies.fulfillmentPolicyId = free.policyId;
  }
  if (!policies.fulfillmentPolicyId || !policies.paymentPolicyId || !policies.returnPolicyId) {
    return {
      ok: false,
      step: "setup",
      error:
        "Your eBay account is missing business policies. Create a shipping, payment and return policy in eBay Seller Hub, then try again.",
    };
  }

  const location = await ensureMerchantLocation(userId);
  if (!location.ok) {
    return {
      ok: false,
      step: "setup",
      error: `Could not create a merchant location on eBay: ${location.error}`,
      details: location.details,
    };
  }

  const token = await getAccessTokenForUser(userId);
  if (!token) return { ok: false, step: "setup", error: "No eBay store connected. Connect your store in Settings." };

  return {
    ok: true,
    seller: {
      token,
      merchantLocationKey: location.locationKey,
      listingPolicies: {
        fulfillmentPolicyId: policies.fulfillmentPolicyId,
        paymentPolicyId: policies.paymentPolicyId,
        returnPolicyId: policies.returnPolicyId,
      },
    },
  };
}

/**
 * eBay takes up to 24 pictures; the first is the gallery (main) image. Every
 * picture goes as an external http(s) URL that eBay fetches itself, so
 * anything else (e.g. a data: URI) is dropped rather than rejected by eBay.
 */
function pictureList(urls: Array<string | null | undefined>) {
  return [...new Set(urls.map((url) => url?.trim() ?? "").filter((url) => /^https?:\/\/\S+$/i.test(url)))].slice(0, 24);
}

function offerBody(
  seller: Seller,
  offer: { sku: string; quantity: number; price: number; categoryId: string; description?: string },
) {
  return JSON.stringify({
    sku: offer.sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: offer.quantity,
    categoryId: offer.categoryId,
    // A multi-variation listing takes its description from the item group instead.
    ...(offer.description !== undefined ? { listingDescription: offer.description } : {}),
    pricingSummary: { price: { value: offer.price.toFixed(2), currency: "USD" } },
    listingPolicies: seller.listingPolicies,
    merchantLocationKey: seller.merchantLocationKey,
  });
}

/**
 * Creates the offer for a SKU. eBay allows one offer per SKU and marketplace,
 * so if an earlier run already created it, reuse that offer (updated to
 * today's details) instead of failing — never delete and recreate it.
 */
async function upsertOffer(token: string, sku: string, body: string): Promise<{ ok: true; offerId: string } | PublishFailure> {
  const offer = await ebayFetch<{ offerId?: string }>("/sell/inventory/v1/offer", token, { method: "POST", body });
  let offerId = offer.offerId;
  if (!offerId && isOfferAlreadyExists(offer.errors)) {
    offerId = offerIdFromErrors(offer.errors) ?? (await findExistingOffer(token, sku))?.offerId;
    console.warn(
      `[ebay-offer] sku ${sku}: offer already exists; fallback=reuse offerId=${offerId ?? "not found"}. eBay said:`,
      JSON.stringify(offer.errors),
    );
    if (offerId) {
      const updated = await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, token, {
        method: "PUT",
        body,
      });
      if (updated.errors?.length) {
        console.error(`[ebay-offer] sku ${sku}: updating existing offer ${offerId} failed:`, JSON.stringify(updated.errors));
        return { ok: false, step: "offer", error: ebayErrorMessage(updated, "eBay would not update the existing offer.") };
      }
    }
  } else if (!offerId) {
    console.error(`[ebay-offer] sku ${sku}: create offer failed (no fallback):`, JSON.stringify(offer.errors));
  }
  if (!offerId) {
    return { ok: false, step: "offer", error: ebayErrorMessage(offer, "eBay did not return an offer ID.") };
  }
  return { ok: true, offerId };
}

/**
 * Publishes one fixed-price listing through the Inventory API:
 * market price check → inventory item → offer → publish → Promoted Listings.
 * Each step reports where it stopped. With two or more `variations` it
 * publishes a multi-variation listing instead. Once live, the listing is
 * added to Promoted Listings (General) at the seller's ad rate (4% by
 * default); offers have no ad-rate field, so this goes through the Marketing
 * API (see promoted.ts) and its outcome is reported, never fatal.
 */
export async function publishListing(input: PublishInput): Promise<PublishResult> {
  const published = await publishOnly(input);
  if (!published.ok) return published;
  const { adRatePct } = await getListingDefaults(input.userId);
  const promotion = await promoteListing(input.userId, published.listingId, adRatePct);
  return { ...published, promotion };
}

const unescapeAttr = (text: string) => text.replace(/&amp;/g, "&");
const escapeAttr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * The listing with every image on eBay Picture Services (see media.ts):
 *  - gallery and variation pictures: their EPS copies. One eBay won't take is
 *    left out so the gallery stays all-EPS; if it takes none, the original URLs
 *    are kept (the listing still publishes, as before) and a warning is logged.
 *  - <img> in the description (the size chart): its EPS copy, or, when eBay
 *    won't take it, the original HTTPS image, still embedded (logged).
 * Never fails the listing.
 */
async function withEbayHostedImages(input: PublishInput): Promise<PublishInput> {
  const token = await getAccessTokenForUser(input.userId);
  if (!token) return input;
  const gallery = pictureList(input.imageUrls);
  const variantPictures = (input.variations ?? []).map((v) => v.imageUrl).filter((u): u is string => Boolean(u));
  const inDescription = descriptionImageSources(input.description);
  const hosted = await hostAllOnEbay(token, [...gallery, ...variantPictures, ...inDescription]);

  const hostedGallery = gallery.map((url) => hosted.get(url)).filter((url): url is string => Boolean(url));
  const allEps = hostedGallery.length > 0;
  if (!allEps) {
    console.warn(`[ebay-media] sku ${input.sku}: eBay took none of ${gallery.length} pictures; publishing them self-hosted.`);
  } else if (hostedGallery.length < gallery.length) {
    console.warn(`[ebay-media] sku ${input.sku}: ${gallery.length - hostedGallery.length} picture(s) eBay wouldn't take were left out.`);
  }
  const missingCharts = inDescription.filter((url) => !hosted.has(url));
  if (missingCharts.length) {
    console.warn(`[ebay-media] sku ${input.sku}: ${missingCharts.length} description image(s) kept at their original URL.`);
  }

  return {
    ...input,
    imageUrls: allEps ? hostedGallery : gallery,
    description: input.description.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (whole, open: string, src: string, close: string) => {
      const copy = hosted.get(unescapeAttr(src));
      return copy ? `${open}${escapeAttr(copy)}${close}` : whole;
    }),
    variations: input.variations?.map((v) => ({
      ...v,
      // An all-EPS listing can't carry a self-hosted variant picture: drop one eBay wouldn't take.
      imageUrl: v.imageUrl ? (hosted.get(v.imageUrl) ?? (allEps ? null : v.imageUrl)) : v.imageUrl,
    })),
  };
}

/** What a product with variants gets instead of a listing when they can't go out as eBay variations. */
export const VARIANTS_INVALID = "Variant data invalid. Product not listed.";

/**
 * Why `variations` can't make an eBay multi-variation listing, or null. The
 * resolver already checked them against the category (variationProblem);
 * this is the last check before anything is sent, so a listing with variants
 * is never published without its Color/Size choices.
 */
function variationDataProblem(variations: PublishVariation[]): string | null {
  const names = Object.keys(variations[0]?.aspects ?? {}).sort();
  if (!names.length) return "the variants have no Color or Size";
  const skus = new Set<string>();
  const combos = new Set<string>();
  for (const variant of variations) {
    if (!variant.sku) return "a variant has no SKU";
    if (skus.has(variant.sku)) return `two variants share the SKU ${variant.sku}`;
    skus.add(variant.sku);
    if (Object.keys(variant.aspects).sort().join("|") !== names.join("|")) return "the variants do not all have the same options";
    const missing = names.find((name) => !variant.aspects[name]?.trim());
    if (missing) return `variant ${variant.sku} has no ${missing}`;
    if (!(variant.price > 0)) return `variant ${variant.sku} has no price`;
    const combo = names.map((name) => variant.aspects[name].trim().toLowerCase()).join("|");
    if (combos.has(combo)) return `two variants are both "${names.map((name) => variant.aspects[name]).join(" / ")}"`;
    combos.add(combo);
  }
  return null;
}

async function publishOnly(original: PublishInput): Promise<PublishResult> {
  const multi = original.variations && original.variations.length > 1;
  if (multi && original.variations) {
    const problem = variationDataProblem(original.variations);
    if (problem) {
      console.warn(`[ebay-variations] sku ${original.sku}: not listed because ${problem}.`);
      return { ok: false, step: "variants", error: `${VARIANTS_INVALID} Reason: ${problem}.` };
    }
  }

  // 0. Market price: nothing is sent to eBay when the price is far above what
  // the same item sells for there (it would never sell). For variations, the
  // cheapest variant is the one a buyer compares.
  const askPrice = multi ? Math.min(...(original.variations ?? []).map((v) => v.price)) : original.price;
  const warning = await marketPriceWarning(original.title, askPrice);
  if (warning) return { ok: false, step: "market", error: warning };

  // Every picture on eBay's own hosting, so photos added later in eBay's editor never mix hosting types.
  const input = await withEbayHostedImages(original);
  if (multi && input.variations) return publishVariationListing(input, input.variations);

  const prepared = await prepareSeller(input.userId, { freeShipping: input.freeShipping });
  if (!prepared.ok) return prepared;
  const { seller } = prepared;
  const { token } = seller;

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
        imageUrls: pictureList(input.imageUrls),
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
  const offer = await upsertOffer(
    token,
    input.sku,
    offerBody(seller, {
      sku: input.sku,
      quantity: input.quantity,
      price: input.price,
      categoryId: input.categoryId,
      description: input.description,
    }),
  );
  if (!offer.ok) return offer;
  const { offerId } = offer;

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

/** Runs `work` over `items` a few at a time; stops at the first failure. */
async function eachInChunks<T, R extends { ok: boolean }>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += 5) {
    const results = await Promise.all(items.slice(i, i + 5).map(work));
    out.push(...results);
    if (results.some((r) => !r.ok)) break;
  }
  return out;
}

/**
 * Multi-variation listing (e.g. one listing with Color and Size dropdowns):
 * 1. an inventory item per variant SKU, carrying its own Color/Size;
 * 2. an inventory item group (key = the product SKU) listing those SKUs and
 *    the values each aspect varies by;
 * 3. an offer per variant SKU (its own price and quantity);
 * 4. publish_by_inventory_item_group, which creates the single eBay listing.
 */
async function publishVariationListing(input: PublishInput, variations: PublishVariation[]): Promise<PublishResult> {
  const prepared = await prepareSeller(input.userId, { freeShipping: input.freeShipping });
  if (!prepared.ok) return prepared;
  const { seller } = prepared;
  const { token } = seller;
  const groupKey = input.sku;

  const varyBy = [...new Set(variations.flatMap((v) => Object.keys(v.aspects)))];
  const isVaried = (name: string) => varyBy.some((n) => n.toLowerCase() === name.toLowerCase());
  // Shared item specifics go on the group; the aspects it varies by go only on each variant.
  const shared = Object.fromEntries(Object.entries(input.aspects ?? {}).filter(([name]) => !isVaried(name)));
  const productPictures = pictureList(input.imageUrls);

  // 1. One inventory item per variant.
  const items = await eachInChunks(variations, async (variant) => {
    const item = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(variant.sku)}`, token, {
      method: "PUT",
      body: JSON.stringify({
        availability: { shipToLocationAvailability: { quantity: variant.quantity } },
        condition: input.condition ?? "NEW",
        product: {
          title: input.title.slice(0, 80),
          description: input.description,
          // The variant's own photo first, so picking it on eBay shows that photo.
          imageUrls: pictureList([variant.imageUrl, ...productPictures]),
          aspects: { ...shared, ...Object.fromEntries(Object.entries(variant.aspects).map(([k, v]) => [k, [v]])) },
          ...(input.brand ? { brand: input.brand } : {}),
          ...(input.mpn ? { mpn: input.mpn } : {}),
        },
      }),
    });
    return item.errors?.length
      ? { ok: false as const, error: `Variant ${variant.sku}: ${ebayErrorMessage(item, "eBay rejected the inventory item.")}` }
      : { ok: true as const };
  });
  const badItem = items.find((r) => !r.ok);
  if (badItem && !badItem.ok) return { ok: false, step: "item", error: badItem.error };

  // 2. The group that ties the variants into one listing.
  const variantImages = new Set(variations.map((v) => v.imageUrl).filter(Boolean));
  const group = await ebayFetch(`/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`, token, {
    method: "PUT",
    body: JSON.stringify({
      title: input.title.slice(0, 80),
      description: input.description,
      imageUrls: productPictures,
      aspects: shared,
      variantSKUs: variations.map((v) => v.sku),
      variesBy: {
        aspectsImageVariesBy: varyBy.includes("Color") && variantImages.size > 1 ? ["Color"] : [],
        specifications: varyBy.map((name) => ({ name, values: [...new Set(variations.map((v) => v.aspects[name]))] })),
      },
    }),
  });
  if (group.errors?.length) {
    console.error(`[ebay-variations] group ${groupKey}: create failed:`, JSON.stringify(group.errors));
    return { ok: false, step: "item", error: ebayErrorMessage(group, "eBay rejected the variation group.") };
  }

  // 3. One offer per variant.
  const offers = await eachInChunks(variations, (variant) =>
    upsertOffer(
      token,
      variant.sku,
      offerBody(seller, { sku: variant.sku, quantity: variant.quantity, price: variant.price, categoryId: input.categoryId }),
    ),
  );
  const badOffer = offers.find((r) => !r.ok);
  if (badOffer && !badOffer.ok) return badOffer;
  const firstOfferId = offers[0]?.ok ? offers[0].offerId : "";

  // 4. Publish the group. If it is already live, the existing listing is the result we wanted.
  const published = await ebayFetch<{ listingId?: string }>("/sell/inventory/v1/offer/publish_by_inventory_item_group", token, {
    method: "POST",
    body: JSON.stringify({ inventoryItemGroupKey: groupKey, marketplaceId: "EBAY_US" }),
  });
  let listingId = published.listingId;
  if (!listingId) {
    const existing = firstOfferId ? await getOffer(token, firstOfferId) : null;
    if (existing?.status === "PUBLISHED" && existing.listingId) {
      listingId = existing.listingId;
      console.warn(
        `[ebay-variations] group ${groupKey}: already published; fallback=existing listing ${listingId}. eBay said:`,
        JSON.stringify(published.errors),
      );
    } else {
      console.error(`[ebay-variations] group ${groupKey}: publish failed:`, JSON.stringify(published.errors));
      return { ok: false, step: "publish", error: ebayErrorMessage(published, "eBay did not return a listing ID.") };
    }
  }

  return { ok: true, offerId: firstOfferId, listingId, variations: variations.length };
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
