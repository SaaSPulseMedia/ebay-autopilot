import { db } from "@/db";
import { ebayAccounts, listings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { publishViaApi } from "@/lib/ebay/api-list";
import { publishViaBrowser, isBrowserEngineAvailable } from "@/lib/ebay/browser-list";
import { publishViaDemo } from "@/lib/ebay/demo-list";
import type { ListingDraft, ListingEngine, ListingResult } from "@/lib/ebay/types";
import { planLimits } from "@/lib/limits";
import { and, count, desc, eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

function parseEngine(value: unknown): ListingEngine | "auto" {
  return value === "api" || value === "browser" || value === "demo" ? value : "auto";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.userId, user.id))
    .orderBy(desc(listings.createdAt))
    .limit(100);

  return Response.json({ ok: true, listings: rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Partial<ListingDraft> & { engine?: unknown };
  const title = (body.title ?? "").trim();
  if (!title) return Response.json({ ok: false, error: "A listing title is required." }, { status: 400 });

  const draft: ListingDraft = {
    title: title.slice(0, 80),
    description: body.description ?? "",
    listPrice: Number(body.listPrice ?? 0),
    supplierPrice: Number(body.supplierPrice ?? 0),
    sourceUrl: body.sourceUrl ?? null,
    imageUrl: body.imageUrl ?? null,
    quantity: Number(body.quantity ?? 1),
  };

  // Single listings count against the same active-listing cap as bulk runs.
  const limits = planLimits(user.plan);
  const [{ count: activeCount }] = await db
    .select({ count: count() })
    .from(listings)
    .where(and(eq(listings.userId, user.id), inArray(listings.status, ["active", "queued"])));

  if (activeCount >= limits.activeListings) {
    return Response.json(
      {
        ok: false,
        error: `You are at your ${limits.planName} limit of ${limits.activeListings} active listings. End some listings or upgrade to publish more.`,
        upgrade: true,
      },
      { status: 403 },
    );
  }

  const [account] = await db
    .select()
    .from(ebayAccounts)
    .where(and(eq(ebayAccounts.userId, user.id), eq(ebayAccounts.mode, "oauth")))
    .limit(1);

  const requested = parseEngine(body.engine);
  // Engine routing: explicit choice wins, otherwise API > browser > demo.
  const order: ListingEngine[] =
    requested === "auto"
      ? [account ? "api" : "demo", isBrowserEngineAvailable() ? "browser" : "demo", "demo"]
      : [requested, "demo"];

  let result: ListingResult | null = null;
  for (const engine of order) {
    if (engine === "api") result = await publishViaApi(draft, account?.accessToken ?? null);
    else if (engine === "browser") result = await publishViaBrowser(draft);
    else result = await publishViaDemo(draft);

    if (result.status === "published" || result.status === "queued") break;
  }

  const final = result ?? (await publishViaDemo(draft));

  const [saved] = await db
    .insert(listings)
    .values({
      userId: user.id,
      title: draft.title,
      description: draft.description,
      sourceUrl: draft.sourceUrl,
      imageUrl: draft.imageUrl,
      supplierPrice: draft.supplierPrice.toFixed(2),
      listPrice: draft.listPrice.toFixed(2),
      engine: final.engine,
      status: final.status === "published" ? "active" : final.status === "queued" ? "queued" : "draft",
      ebayItemId: final.itemId,
      aiGenerated: Boolean(body.description),
      payload: draft,
    })
    .returning();

  return Response.json({ ok: true, result: final, listing: saved });
}
