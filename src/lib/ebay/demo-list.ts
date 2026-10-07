import "server-only";

import type { ListingDraft, ListingResult } from "./types";

/** Demo engine: runs the whole pipeline, stops short of calling eBay. */
export async function publishViaDemo(draft: ListingDraft): Promise<ListingResult> {
  const itemId = `DEMO-${Date.now().toString(36).toUpperCase()}`;
  return {
    engine: "demo",
    status: "published",
    message: "Created in demo mode. Nothing was sent to eBay.",
    itemId,
    title: draft.title,
  };
}
