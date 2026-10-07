import { timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { EBAY_STATE_COOKIE, exchangeCodeForTokens, isEbayConfigured, isEbaySandbox } from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

function sameValue(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** eBay sends the seller back here after its consent screen ("auth accepted URL"). */
export async function GET(request: Request) {
  const settings = (status: string) => {
    const response = NextResponse.redirect(new URL(`/dashboard/settings?ebay=${status}`, request.url), 303);
    response.cookies.delete({ name: EBAY_STATE_COOKIE, path: "/api/ebay" });
    return response;
  };

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!isEbayConfigured()) return settings("not-configured");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (!code) return settings("denied");

  // The callback must belong to a connection this browser started, for this user.
  const expected = (await cookies()).get(EBAY_STATE_COOKIE)?.value ?? "";
  if (!expected || !sameValue(expected, `${user.id}.${state}`)) return settings("expired");

  const result = await exchangeCodeForTokens(code);
  if (!result.ok) {
    console.error(`[ebay] code exchange failed for user ${user.id}: ${result.error}`);
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
    .where(and(eq(ebayAccounts.userId, user.id), eq(ebayAccounts.mode, "oauth")))
    .limit(1);

  if (existing) {
    await db.update(ebayAccounts).set(values).where(eq(ebayAccounts.id, existing.id));
  } else {
    await db.insert(ebayAccounts).values({ userId: user.id, ...values });
  }

  return settings("connected");
}
