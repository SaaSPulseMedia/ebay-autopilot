import { timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { verifyPurposeToken } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { ensureMerchantLocation } from "@/lib/ebay/account";
import {
  EBAY_STATE_COOKIE,
  EBAY_STATE_PURPOSE,
  exchangeCodeForTokens,
  isEbayConfigured,
  isEbaySandbox,
  siteOrigin,
} from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

function sameValue(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * eBay sends the seller back here after its consent screen. Configure this URL
 * as BOTH the "auth accepted URL" and the "auth declined URL" of the RuName.
 *
 * The seller may not be signed in on this domain (see EBAY_AUTH_ORIGIN), so the
 * user comes from the signed state cookie set by /api/ebay/connect — never from
 * the query string. The seller always ends up back on the main site's Settings.
 */
export async function GET(request: Request) {
  const settings = (status: string) => {
    const response = NextResponse.redirect(
      new URL(`/dashboard/settings?ebay=${status}`, siteOrigin(request)),
      303,
    );
    response.cookies.delete({ name: EBAY_STATE_COOKIE, path: "/api/ebay" });
    return response;
  };

  if (!isEbayConfigured()) return settings("not-configured");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (!code) return settings("denied");

  const stored = await verifyPurposeToken((await cookies()).get(EBAY_STATE_COOKIE)?.value, EBAY_STATE_PURPOSE);
  const expectedState = typeof stored?.claims.state === "string" ? stored.claims.state : "";
  if (!stored || !expectedState || !sameValue(expectedState, state)) return settings("expired");
  const userId = stored.uid;

  const result = await exchangeCodeForTokens(code);
  if (!result.ok) {
    console.error(`[ebay] code exchange failed for user ${userId}: ${result.error}`);
    return settings("error");
  }

  const values = {
    label: isEbaySandbox() ? "eBay Sandbox test store" : "eBay store",
    mode: "oauth",
    accessToken: encryptSecret(result.tokens.accessToken),
    refreshToken: result.tokens.refreshToken ? encryptSecret(result.tokens.refreshToken) : null,
    tokenExpiresAt: result.tokens.accessTokenExpiresAt,
    connectedAt: new Date(),
  };

  // One connection per seller for now: reconnecting replaces the old tokens.
  const [existing] = await db
    .select({ id: ebayAccounts.id })
    .from(ebayAccounts)
    .where(and(eq(ebayAccounts.userId, userId), eq(ebayAccounts.mode, "oauth")))
    .limit(1);

  if (existing) {
    await db.update(ebayAccounts).set(values).where(eq(ebayAccounts.id, existing.id));
  } else {
    await db.insert(ebayAccounts).values({ userId, ...values });
  }

  // Offers need a merchant location; set one up now so the first publish is ready.
  // Never block the connection on it — publishListing retries this preflight.
  try {
    await ensureMerchantLocation(userId);
  } catch (error) {
    console.warn(`[ebay] merchant location setup failed for user ${userId}:`, error);
  }

  return settings("connected");
}
