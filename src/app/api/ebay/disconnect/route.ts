import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Forgets the seller's eBay tokens. The seller can also withdraw the permission
 * on eBay's side (Account settings → third-party app access).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  await db.delete(ebayAccounts).where(and(eq(ebayAccounts.userId, user.id), eq(ebayAccounts.mode, "oauth")));

  return NextResponse.redirect(new URL("/dashboard/settings?ebay=disconnected", request.url), 303);
}
