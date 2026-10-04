import { randomUUID } from "node:crypto";

import { getCurrentUser } from "@/lib/auth";
import { authorizeUrl, isEbayConfigured } from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login", request.url), 303);

  if (!isEbayConfigured()) {
    return Response.redirect(new URL("/dashboard/settings?ebay=not-configured", request.url), 303);
  }

  const state = `${user.id}.${randomUUID()}`;
  return Response.redirect(authorizeUrl(state), 303);
}
