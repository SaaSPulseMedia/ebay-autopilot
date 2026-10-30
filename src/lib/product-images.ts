import "server-only";

import { randomBytes } from "node:crypto";

import { and, count, eq, inArray } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/db";
import { productImages, uploadedImages } from "@/db/schema";

/**
 * Seller-managed product images: a per-seller ordered list that replaces the
 * supplier's images when present, plus image uploads served from
 * /api/images/<id>.jpg (a public URL, which is what eBay needs).
 */

/** eBay's picture limit per listing. */
export const MAX_IMAGES = 24;
/** Most uploads one seller can store. */
export const MAX_UPLOADS_PER_USER = 300;
/** Vercel rejects request bodies over 4.5 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** eBay needs at least 500 px on the longest side; 800 leaves headroom and enables zoom. */
const MIN_LONG_SIDE = 800;
const MAX_LONG_SIDE = 1600;

const UPLOAD_PATH = /\/api\/images\/([a-f0-9]{24})\.jpg$/;

/** The upload id in one of our image URLs, or null for any other URL. */
export function uploadIdFromUrl(url: string) {
  return url.match(UPLOAD_PATH)?.[1] ?? null;
}

/**
 * Base URL for links eBay fetches. The production domain is stable across
 * deploys; the request's own origin is the fallback (and what local dev uses).
 */
export function publicBaseUrl(request: Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return new URL(request.url).origin;
}

export const isWebUrl = (url: unknown): url is string => typeof url === "string" && /^https?:\/\/\S+$/i.test(url.trim());

/** The supplier's images for a catalog product, main first. */
export function supplierImages(product: { images: string[]; imageUrl: string | null }) {
  const list = product.images.length ? product.images : product.imageUrl ? [product.imageUrl] : [];
  return [...new Set(list.filter(isWebUrl))];
}

/** The seller's saved image lists, keyed by catalog externalId. */
export async function userImageLists(userId: number, externalIds?: string[]) {
  if (externalIds && !externalIds.length) return new Map<string, string[]>();
  const rows = await db
    .select({ externalId: productImages.externalId, images: productImages.images })
    .from(productImages)
    .where(
      externalIds
        ? and(eq(productImages.userId, userId), inArray(productImages.externalId, externalIds))
        : eq(productImages.userId, userId),
    );
  return new Map(rows.map((r) => [r.externalId, (r.images ?? []).filter(isWebUrl)]));
}

/**
 * Catalog products with the seller's own image list applied: `images` and
 * `imageUrl` (the main image) come from it when one is saved. Products
 * without one are returned unchanged.
 */
export async function withUserImages<T extends { externalId: string; images: string[]; imageUrl: string | null }>(
  userId: number,
  products: T[],
): Promise<Array<T & { customImages: boolean }>> {
  let lists = new Map<string, string[]>();
  try {
    lists = await userImageLists(
      userId,
      products.map((p) => p.externalId),
    );
  } catch (error) {
    // Table not created yet (or DB hiccup): fall back to supplier images.
    console.error("[images] could not load saved image lists:", error instanceof Error ? error.message : error);
  }
  return products.map((product) => {
    const list = lists.get(product.externalId);
    return list?.length
      ? { ...product, images: list, imageUrl: list[0], customImages: true }
      : { ...product, customImages: false };
  });
}

export async function saveImageList(userId: number, externalId: string, images: string[]) {
  await db
    .insert(productImages)
    .values({ userId, externalId, images, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [productImages.userId, productImages.externalId],
      set: { images, updatedAt: new Date() },
    });
}

export async function resetImageList(userId: number, externalId: string) {
  await db.delete(productImages).where(and(eq(productImages.userId, userId), eq(productImages.externalId, externalId)));
}

/** Which of these upload ids belong to the seller. */
export async function ownedUploadIds(userId: number, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .select({ id: uploadedImages.id })
    .from(uploadedImages)
    .where(and(eq(uploadedImages.userId, userId), inArray(uploadedImages.id, ids)));
  return new Set(rows.map((r) => r.id));
}

export async function uploadCount(userId: number) {
  const [row] = await db.select({ value: count() }).from(uploadedImages).where(eq(uploadedImages.userId, userId));
  return row?.value ?? 0;
}

export type ProcessedImage = { data: Buffer; width: number; height: number };

/**
 * Normalizes an upload for eBay: applies the photo's EXIF rotation, flattens
 * transparency onto white, scales so the longest side is between 800 and
 * 1600 px (small images are enlarged), and re-encodes as JPEG. Throws on
 * anything sharp can't read as an image.
 */
export async function processUpload(input: Buffer): Promise<ProcessedImage> {
  const image = sharp(input, { failOn: "error", limitInputPixels: 60_000_000 }).rotate();
  const meta = await image.metadata();
  // After rotate(), orientations 5–8 swap width and height.
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new Error("That file is not an image we can read.");

  const longSide = Math.max(width, height);
  const target = Math.min(MAX_LONG_SIDE, Math.max(MIN_LONG_SIDE, longSide));
  const scale = target / longSide;
  const { data, info } = await image
    .resize({ width: Math.round(width * scale), height: Math.round(height * scale), fit: "fill" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function storeUpload(userId: number, image: ProcessedImage) {
  const id = randomBytes(12).toString("hex");
  await db.insert(uploadedImages).values({
    id,
    userId,
    contentType: "image/jpeg",
    data: image.data.toString("base64"),
    width: image.width,
    height: image.height,
    bytes: image.data.length,
  });
  return id;
}

/** eBay's Picture Policy: the longest side must be at least this many pixels. */
const EBAY_MIN_LONG_SIDE = 500;
const FETCH_TIMEOUT_MS = 6_000;
/** Enough of a JPEG, PNG or WebP file to read its width and height. */
const HEAD_BYTES = 64 * 1024;
/** Supplier pictures larger than this aren't downloaded to be measured (they are big enough anyway). */
const MAX_FETCH_BYTES = 15 * 1024 * 1024;
const sizeCache = new Map<string, string | null>();

/** Base URL eBay can fetch our own images from, without a request (production domain); null when unknown. */
function serverBaseUrl() {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
}

/**
 * The URL to give eBay for a supplier picture: the same URL when it is big
 * enough (or can't be checked), an enlarged copy served from /api/images when
 * it is under eBay's 500 px minimum, or null when it is too small and can't
 * be enlarged here (eBay rejects the whole listing for one such picture).
 */
async function bigEnoughUrl(userId: number, url: string): Promise<string | null> {
  if (UPLOAD_PATH.test(url) || /(^|\.)ebayimg\.com\//i.test(url.replace(/^https?:\/\//, ""))) return url;
  const key = `${userId}:${url}`;
  if (sizeCache.has(key)) return sizeCache.get(key) ?? null;
  let result: string | null = url;
  try {
    // The size is in the file's first bytes: only those are fetched (servers that ignore Range send it all).
    const head = await fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
    let meta = head.ok ? await sharp(Buffer.from(await head.arrayBuffer())).metadata().catch(() => null) : null;
    let whole: Buffer | null = null;
    if (!meta?.width && head.ok) {
      // Some formats (e.g. WebP) can't be measured from part of the file: fetch it all (when not huge).
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
      if (res.ok && Number(res.headers.get("content-length") ?? 0) <= MAX_FETCH_BYTES) {
        whole = Buffer.from(await res.arrayBuffer());
        meta = await sharp(whole).metadata().catch(() => null);
      }
    }
    const longSide = Math.max(meta?.width ?? 0, meta?.height ?? 0);
    if (longSide > 0 && longSide < EBAY_MIN_LONG_SIDE) {
      // Small pictures are small files: the whole one is fetched (if it isn't yet) to enlarge it.
      if (!whole) {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
        if (res.ok && Number(res.headers.get("content-length") ?? 0) <= MAX_FETCH_BYTES) whole = Buffer.from(await res.arrayBuffer());
      }
      const base = serverBaseUrl();
      result = base && whole ? `${base}/api/images/${await storeUpload(userId, await processUpload(whole))}.jpg` : null;
      console.log(`[ebay-media] picture ${longSide}px is under eBay's ${EBAY_MIN_LONG_SIDE}px: ${result ? "enlarged" : "left out"}`);
    }
  } catch (error) {
    // Can't measure it: send it as it is (eBay's own check still applies).
    console.warn(`[ebay-media] couldn't measure ${url.slice(0, 120)}: ${error instanceof Error ? error.message : error}`);
  }
  sizeCache.set(key, result);
  return result;
}

/** bigEnoughUrl for many pictures, ten at a time: original URL → URL to use (null: leave it out). */
export async function bigEnoughPictures(userId: number, urls: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const out = new Map<string, string | null>();
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const checked = await Promise.all(batch.map((url) => bigEnoughUrl(userId, url)));
    batch.forEach((url, j) => out.set(url, checked[j]));
  }
  return out;
}
