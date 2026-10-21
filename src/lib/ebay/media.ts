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

/** EPS copies of many URLs, five at a time; the map holds only the ones eBay took. */
export async function hostAllOnEbay(token: string, urls: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const hosted = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 5) {
    const batch = unique.slice(i, i + 5);
    const copies = await Promise.all(batch.map((url) => hostOnEbay(token, url)));
    batch.forEach((url, j) => {
      if (copies[j]) hosted.set(url, copies[j] as string);
    });
  }
  return hosted;
}
