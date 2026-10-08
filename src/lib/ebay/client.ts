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
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
      cache: "no-store",
    });
    if (res.status === 204) return {} as T & EbayErrorBody;
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = null;
    }
    if (json && typeof json === "object") {
      const body = json as T & EbayErrorBody;
      if (!res.ok && !body.errors?.length) {
        return { ...body, errors: [{ message: `eBay returned HTTP ${res.status}` }] };
      }
      return body;
    }
    return { errors: [{ message: `eBay returned HTTP ${res.status}` }] } as T & EbayErrorBody;
  } catch (error) {
    return { errors: [{ message: error instanceof Error ? error.message : "Could not reach eBay." }] } as T &
      EbayErrorBody;
  }
}

/** First human-readable message from an eBay error payload. */
export function ebayErrorMessage(body: EbayErrorBody, fallback: string) {
  const first = body.errors?.[0];
  return first?.longMessage || first?.message || fallback;
}
