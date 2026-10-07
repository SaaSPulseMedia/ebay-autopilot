import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { isEbayConfigured, refreshAccessToken } from "@/lib/ebay/oauth";

/** Refresh a little before eBay's expiry so a call never starts with a dying token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * A usable eBay access token for the seller's connected store, refreshing it if
 * needed. Returns null when no store is connected, eBay keys are not configured,
 * or the stored tokens can no longer be used (the seller then reconnects).
 */
export async function getValidAccessToken(userId: number): Promise<string | null> {
  if (!isEbayConfigured()) return null;

  const [account] = await db
    .select()
    .from(ebayAccounts)
    .where(and(eq(ebayAccounts.userId, userId), eq(ebayAccounts.mode, "oauth")))
    .orderBy(desc(ebayAccounts.connectedAt))
    .limit(1);
  if (!account) return null;

  const access = decryptSecret(account.accessToken);
  if (access && account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return access;
  }

  const refresh = decryptSecret(account.refreshToken);
  if (!refresh) return null;

  const result = await refreshAccessToken(refresh);
  if (!result.ok) {
    console.warn(`[ebay] token refresh failed for account ${account.id}: ${result.error}`);
    return null;
  }

  await db
    .update(ebayAccounts)
    .set({
      accessToken: encryptSecret(result.tokens.accessToken),
      tokenExpiresAt: result.tokens.accessTokenExpiresAt,
    })
    .where(eq(ebayAccounts.id, account.id));

  return result.tokens.accessToken;
}
