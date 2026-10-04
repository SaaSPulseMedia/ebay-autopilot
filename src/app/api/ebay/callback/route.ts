import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { exchangeCodeForTokens } from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login", request.url), 303);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return Response.redirect(new URL("/dashboard/settings?ebay=denied", request.url), 303);
  }

  const tokens = await exchangeCodeForTokens(code);

  await db.insert(ebayAccounts).values({
    userId: user.id,
    label: "eBay store",
    mode: tokens.demo ? "demo" : "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.expiresAt,
  });

  return Response.redirect(
    new URL(`/dashboard/settings?ebay=${tokens.demo ? "demo-connected" : "connected"}`, request.url),
    303,
  );
}
