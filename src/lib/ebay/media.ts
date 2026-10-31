import "server-only";

import { ebayErrorMessage, ebayRequest } from "@/lib/ebay/client";
import { isEbaySandbox } from "@/lib/ebay/oauth";

/**
 * eBay Picture Services (EPS) hosting through the Media API. A listing whose
 * pictures are all self-hosted URLs can't take a picture added in eBay's own
 * editor ("Mixture of Self Hosted and EPS pictures"), so every image AutoPilot
 * publishes is first copied to EPS (createImageFromUrl) and listed by its
 * i.ebayimg.com URL. Uses the seller's token (sell.inventory scope, which
 * every connection has). Results are cached per server instance for a day.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; url: string }>();

function mediaBase() {
  return isEbaySandbox() ? "https://apim.sandbox.ebay.com" : "https://apim.ebay.com";
}

/** Already on eBay's picture servers: nothing to copy. */
export function isEbayHosted(url: string) {
  try {
    return /(^|\.)ebayimg\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The EPS copy of one image URL, or null (with a logged warning) when eBay won't take it. */
export async function hostOnEbay(token: string, url: string): Promise<string | null> {
  if (isEbayHosted(url)) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.url;

  const res = await ebayRequest<{ imageUrl?: string }>(`${mediaBase()}/commerce/media/v1_beta/image/create_image_from_url`, token, {
    method: "POST",
    body: JSON.stringify({ imageUrl: url }),
  });
  const hosted = res.body.imageUrl;
  if (res.body.errors?.length || !hosted) {
    console.warn(`[ebay-media] couldn't copy ${url.slice(0, 120)} to eBay: ${ebayErrorMessage(res.body, `HTTP ${res.status}`)}`);
    return null;
  }
  cache.set(url, { at: Date.now(), url: hosted });
  return hosted;
}

/** EPS copies of many URLs, ten at a time; the map holds only the ones eBay took. */
export async function hostAllOnEbay(token: string, urls: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const hosted = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const copies = await Promise.all(batch.map((url) => hostOnEbay(token, url)));
    batch.forEach((url, j) => {
      if (copies[j]) hosted.set(url, copies[j] as string);
    });
  }
  return hosted;
}

/** eBay's video limits: 150 MB per file. */
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const videoCache = new Map<string, { at: number; id: string }>();

/**
 * Copies a supplier video to eBay's video hosting (Media API: createVideo,
 * then uploadVideo with the file's bytes) and returns its video ID for the
 * listing's `videoIds`, or null (with a logged reason) when it can't. eBay
 * takes the ID straight away; the video shows on the listing once eBay has
 * processed it (usually a few minutes). Never fails the listing.
 */
export async function hostVideoOnEbay(token: string, url: string, title: string): Promise<{ id: string } | { reason: string }> {
  if (!/^https?:\/\//i.test(url)) return { reason: "CJ's video link isn't a web address" };
  const hit = videoCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { id: hit.id };
  const skip = (why: string) => {
    console.warn(`[ebay-video] skipped ${url.slice(0, 120)}: ${why}`);
    return { reason: why };
  };

  let bytes: ArrayBuffer;
  try {
    const file = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!file.ok) return skip(`the supplier's server returned HTTP ${file.status}`);
    const declared = Number(file.headers.get("content-length") ?? 0);
    if (declared > MAX_VIDEO_BYTES) return skip(`it is ${Math.round(declared / 1048576)} MB (eBay allows 150 MB)`);
    bytes = await file.arrayBuffer();
  } catch (error) {
    return skip(`couldn't download it (${error instanceof Error ? error.message : "network error"})`);
  }
  if (!bytes.byteLength) return skip("the file is empty");
  if (bytes.byteLength > MAX_VIDEO_BYTES) return skip(`it is ${Math.round(bytes.byteLength / 1048576)} MB (eBay allows 150 MB)`);

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  try {
    const created = await fetch(`${mediaBase()}/commerce/media/v1_beta/video`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.slice(0, 80) || "Product video", size: bytes.byteLength, classification: ["ITEM"] }),
      cache: "no-store",
    });
    const id = created.headers.get("location")?.split("/").filter(Boolean).pop();
    if (!created.ok || !id) return skip(`eBay wouldn't create it (HTTP ${created.status}: ${(await created.text()).slice(0, 300)})`);

    const uploaded = await fetch(`${mediaBase()}/commerce/media/v1_beta/video/${encodeURIComponent(id)}/upload`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      body: bytes,
      cache: "no-store",
      // A slow upload is dropped rather than failing the listing (the listing waits at most VIDEO_BUDGET_MS in all).
      signal: AbortSignal.timeout(40_000),
    });
    if (!uploaded.ok) return skip(`eBay refused the upload (HTTP ${uploaded.status}: ${(await uploaded.text()).slice(0, 300)})`);

    console.info(`[ebay-video] uploaded ${url.slice(0, 120)} (${Math.round(bytes.byteLength / 1024)} KB) as video ${id}`);
    videoCache.set(url, { at: Date.now(), id });
    return { id };
  } catch (error) {
    return skip(`couldn't reach eBay (${error instanceof Error ? error.message : "network error"})`);
  }
}
