import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { htmlToText } from "@/lib/cj/facts";
import { cjPidOf, cjProductUrl } from "@/lib/cj/urls";
import { getEbayItemStatus } from "@/lib/ebay/item-status";
import { isEbaySandbox } from "@/lib/ebay/oauth";
import { connectedAccessToken } from "@/lib/listing-pipeline";
import { withUserImages } from "@/lib/product-images";
import { getCatalogProduct } from "@/lib/suppliers";

/**
 * Everything about one product on one screen (the Product Control Center):
 * its images, CJ cost and link, the eBay listing (with its live price, from
 * GetItem, when it was published through the eBay API), sizes, and CJ's
 * description with its size chart images. Built from the listing row and the
 * catalog product it came from (linked by payload.externalId); either may be
 * missing for old or hand-made listings, and the fields say so with nulls.
 */
export type ProductControl = {
  title: string;
  images: string[];
  cj: {
    pid: string | null;
    url: string | null;
    /** Supplier price (cheapest variant). */
    baseCost: number;
    /** AutoPilot's shipping estimate for the product; null when unknown. */
    shipping: number | null;
    landed: number;
  } | null;
  ebay: {
    listingId: number;
    status: string;
    itemId: string | null;
    url: string | null;
    /** The price AutoPilot published. */
    listedPrice: number;
    /** What eBay shows now; null when it couldn't be checked. */
    livePrice: number | null;
    live: "active" | "ended" | "unknown" | "not_checked";
    freeShipping: boolean;
  } | null;
  /** Variant options as "Color / Size" labels, plus the distinct sizes. */
  variants: string[];
  sizes: string[];
  description: string;
  specs: { name: string; value: string }[];
  /** Images from CJ's description: usually the size chart. */
  descriptionImages: string[];
};

type ListingPayload = {
  externalId?: unknown;
  imageUrls?: unknown;
  freeShipping?: unknown;
  description?: unknown;
};

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : []);

export function ebayItemUrl(itemId: string) {
  return `${isEbaySandbox() ? "https://www.sandbox.ebay.com" : "https://www.ebay.com"}/itm/${encodeURIComponent(itemId)}`;
}

/** For one of the seller's listings (`listingId`) or catalog products (`externalId`, plus its latest listing if any). */
export async function getProductControl(
  userId: number,
  ref: { listingId: number } | { externalId: string },
): Promise<ProductControl | null> {
  const [listing] = await db
    .select()
    .from(listings)
    .where(
      "listingId" in ref
        ? and(eq(listings.id, ref.listingId), eq(listings.userId, userId))
        : and(
            eq(listings.userId, userId),
            sql`${listings.payload}->>'externalId' = ${ref.externalId}`,
            ne(listings.status, "ended"),
          ),
    )
    .orderBy(desc(listings.createdAt))
    .limit(1);
  if ("listingId" in ref && !listing) return null;

  const payload = (listing?.payload ?? {}) as ListingPayload;
  const externalId = "externalId" in ref ? ref.externalId : typeof payload.externalId === "string" ? payload.externalId : null;
  const found = externalId ? await getCatalogProduct(userId, externalId) : null;
  if (!listing && !found) return null;
  const [product] = found ? await withUserImages(userId, [found]) : [null];

  const pid = cjPidOf(externalId);
  const baseCost = product?.supplierPrice ?? Number(listing?.supplierPrice ?? 0);
  const shipping = product ? product.shippingCost : null;
  const cjUrl = product?.supplierUrl ?? listing?.sourceUrl ?? (pid ? cjProductUrl(pid, product?.title ?? listing?.title ?? "") : null);

  let ebay: ProductControl["ebay"] = null;
  if (listing) {
    const published = listing.engine === "api" && Boolean(listing.ebayItemId);
    let live: NonNullable<ProductControl["ebay"]>["live"] = "not_checked";
    let livePrice: number | null = null;
    if (published && listing.status !== "ended" && listing.ebayItemId) {
      const token = await connectedAccessToken(userId);
      const status = token ? await getEbayItemStatus(listing.ebayItemId, token) : null;
      live = status?.state ?? "unknown";
      if (status?.state === "active") livePrice = status.price;
    }
    ebay = {
      listingId: listing.id,
      status: listing.status,
      itemId: listing.ebayItemId,
      url: published && listing.ebayItemId ? ebayItemUrl(listing.ebayItemId) : null,
      listedPrice: Number(listing.listPrice),
      livePrice,
      live,
      freeShipping: payload.freeShipping === true,
    };
  }

  const variants = (product?.variants ?? []).map((v) => [v.color, v.size].filter(Boolean).join(" / ") || v.key || v.name);
  const sizes = [...new Set((product?.variants ?? []).map((v) => v.size).filter((s): s is string => Boolean(s)))];
  const images = product?.images.length
    ? product.images
    : strings(payload.imageUrls).length
      ? strings(payload.imageUrls)
      : [listing?.imageUrl ?? product?.imageUrl].filter((u): u is string => Boolean(u));

  return {
    title: listing?.title ?? product?.title ?? "",
    images,
    cj:
      product || pid
        ? { pid, url: cjUrl, baseCost, shipping, landed: Math.round((baseCost + (shipping ?? 0)) * 100) / 100 }
        : null,
    ebay,
    variants: [...new Set(variants.filter(Boolean))],
    sizes,
    description:
      product?.details?.description || htmlToText(typeof payload.description === "string" ? payload.description : listing?.description),
    specs: product?.details?.specs ?? [],
    descriptionImages: product?.details?.descriptionImages ?? [],
  };
}
