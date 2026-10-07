import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { authorizeUrl, EBAY_STATE_COOKIE, isEbayConfigured } from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

/** Sends the seller to eBay's own sign-in and consent screen. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  if (!isEbayConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/settings?ebay=not-configured", request.url), 303);
  }

  // One-time value checked on the way back, so a callback can only complete a
  // connection this browser actually started (protects against forged links).
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authorizeUrl(state), 303);
  response.cookies.set(EBAY_STATE_COOKIE, `${user.id}.${state}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/ebay",
    maxAge: 15 * 60,
  });
  return response;
}
