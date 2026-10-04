import "server-only";

import type { ListingDraft, ListingResult } from "./types";

/**
 * Playwright / headless-Chromium listing engine — STUB.
 *
 * Deliberately not implemented in this milestone. The route keeps the engine
 * selectable so the wiring can be exercised end to end; it reports
 * `status: "unavailable"` until Chromium ships with the deployment.
 */
export function isBrowserEngineAvailable() {
  return process.env.ENABLE_BROWSER_ENGINE === "true" && Boolean(process.env.CHROMIUM_EXECUTABLE_PATH);
}

export async function publishViaBrowser(draft: ListingDraft): Promise<ListingResult> {
  if (!isBrowserEngineAvailable()) {
    return {
      engine: "browser",
      status: "unavailable",
      message:
        "The headless-Chromium fallback is not enabled on this deployment yet. Connect your store with eBay OAuth, or keep drafting in demo mode.",
      itemId: null,
      title: draft.title,
    };
  }
  return {
    engine: "browser",
    status: "unavailable",
    message: "Browser engine is enabled but not implemented in this build.",
    itemId: null,
    title: draft.title,
  };
}
