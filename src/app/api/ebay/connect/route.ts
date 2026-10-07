import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getCurrentUser, signPurposeToken, verifyPurposeToken } from "@/lib/auth";
import {
  authorizeUrl,
  EBAY_STATE_COOKIE,
  EBAY_STATE_PURPOSE,
  ebayAuthOrigin,
  isEbayConfigured,
  requestOrigin,
  siteOrigin,
} from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

const HANDOFF = "ebay-handoff";

/**
 * Starts the eBay connection.
 *
 * 1. On the main site: the signed-in seller is handed to the eBay-facing domain
 *    (EBAY_AUTH_ORIGIN) with a 2-minute signed token, because eBay will only
 *    redirect back to that domain.
 * 2. On the eBay-facing domain: a signed one-time state is stored in a cookie
 *    and the seller is sent to eBay's own sign-in and consent screen.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const home = siteOrigin(request);
  const authOrigin = ebayAuthOrigin(request);

  if (!isEbayConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/settings?ebay=not-configured", home), 303);
  }

  const handoff = await verifyPurposeToken(url.searchParams.get("handoff"), HANDOFF);
  let userId = handoff?.uid ?? null;

  if (!userId) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.redirect(new URL("/login", home), 303);
    userId = user.id;

    // Signed in on the main site but eBay returns to another domain: hand over.
    if (requestOrigin(request) !== authOrigin) {
      const token = await signPurposeToken(HANDOFF, userId, {}, "2m");
      const next = new URL("/api/ebay/connect", authOrigin);
      next.searchParams.set("handoff", token);
      return NextResponse.redirect(next, 303);
    }
  }

  // One-time value checked on the way back, so a callback can only complete a
  // connection this browser actually started (protects against forged links).
  const state = randomBytes(24).toString("base64url");
  const stateToken = await signPurposeToken(EBAY_STATE_PURPOSE, userId, { state }, "15m");

  const response = NextResponse.redirect(authorizeUrl(state), 303);
  response.cookies.set(EBAY_STATE_COOKIE, stateToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/ebay",
    maxAge: 15 * 60,
  });
  return response;
}
