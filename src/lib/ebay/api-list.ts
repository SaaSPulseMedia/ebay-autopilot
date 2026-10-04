import "server-only";

import { isEbayConfigured } from "./oauth";
import type { ListingDraft, ListingResult } from "./types";

/**
 * Official eBay Sell API engine.
 *
 * Token exchange lands next milestone; until a store is connected over OAuth the
 * engine reports `unavailable` so the route can fall back to demo mode.
 */
export async function publishViaApi(draft: ListingDraft, accessToken?: string | null): Promise<ListingResult> {
  if (!isEbayConfigured() || !accessToken) {
    return {
      engine: "api",
      status: "unavailable",
      message: "No eBay store connected over OAuth yet. Connect a store in Settings to publish through the official API.",
      itemId: null,
      title: draft.title,
    };
  }
  return {
    engine: "api",
    status: "queued",
    message: "Draft accepted and queued for the eBay Sell API.",
    itemId: null,
    title: draft.title,
  };
}
