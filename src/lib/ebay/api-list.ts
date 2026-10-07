import "server-only";

import { isEbayConfigured } from "./oauth";
import type { ListingDraft, ListingResult } from "./types";

/**
 * Official eBay Sell (Inventory) API engine.
 *
 * Connecting a store over OAuth is built; publishing through the Inventory API
 * (inventory items, variant groups, offers, business policies) is the next
 * milestone. Until then this engine always reports `unavailable`, so the route
 * falls back to demo mode — it never pretends a listing reached eBay.
 */
export async function publishViaApi(draft: ListingDraft, accessToken?: string | null): Promise<ListingResult> {
  if (!isEbayConfigured() || !accessToken) {
    return {
      engine: "api",
      status: "unavailable",
      message: "No eBay store connected. Connect your store in Settings.",
      itemId: null,
      title: draft.title,
    };
  }
  return {
    engine: "api",
    status: "unavailable",
    message: "Your store is connected, but publishing straight to eBay is still being built.",
    itemId: null,
    title: draft.title,
  };
}
