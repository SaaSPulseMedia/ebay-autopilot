import "server-only";

import { isEbaySandbox } from "@/lib/ebay/oauth";
import { getValidAccessToken } from "@/lib/ebay/tokens";

/** Shape of eBay's REST error payloads (Inventory, Account, …). */
export type EbayError = { errorId?: number; message?: string; longMessage?: string };
export type EbayErrorBody = { errors?: EbayError[] };

/**
 * A usable access token for the seller's connected store. Decrypts the stored
 * token, refreshes it when it expires in under 5 minutes, and writes the new
 * token back (see getValidAccessToken). Null when no store is connected.
 */
export function getAccessTokenForUser(userId: number): Promise<string | null> {
  return getValidAccessToken(userId);
}

function apiBase() {
  return isEbaySandbox() ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

/**
 * Calls an eBay REST path (e.g. "/sell/inventory/v1/offer"). Never throws:
 * 204 → {}, otherwise the parsed JSON. Network failures and non-JSON error
 * bodies come back as `{ errors: [{ message }] }` so callers check one shape.
 */
export async function ebayFetch<T = Record<string, unknown>>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T & EbayErrorBody> {
  return (await ebayRequest<T>(path, accessToken, init)).body;
}

/** Same as ebayFetch, plus the HTTP status (0 when eBay could not be reached). */
export async function ebayRequest<T = Record<string, unknown>>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T & EbayErrorBody }> {
  type Body = T & EbayErrorBody;
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        // Node's fetch otherwise sends `Accept-Language: *`, which eBay rejects.
        "Accept-Language": "en-US",
      },
      cache: "no-store",
    });
    const status = res.status;
    if (status === 204) return { status, body: {} as Body };
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = null;
    }
    if (json && typeof json === "object") {
      const body = json as Body;
      if (!res.ok && !body.errors?.length) {
        return { status, body: { ...body, errors: [{ message: `eBay returned HTTP ${status}` }] } };
      }
      return { status, body };
    }
    return { status, body: { errors: [{ message: `eBay returned HTTP ${status}` }] } as Body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach eBay.";
    return { status: 0, body: { errors: [{ message }] } as Body };
  }
}

/** First human-readable message from an eBay error payload. */
export function ebayErrorMessage(body: EbayErrorBody, fallback: string) {
  const first = body.errors?.[0];
  return first?.longMessage || first?.message || fallback;
}
