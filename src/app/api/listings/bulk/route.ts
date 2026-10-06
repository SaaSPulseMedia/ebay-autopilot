import { randomUUID } from "node:crypto";

import { getCurrentUser } from "@/lib/auth";
import { planLimits } from "@/lib/limits";
import {
  checkPlanCapacity,
  connectedAccessToken,
  createListing,
  inChunks,
  parseEngine,
  summarizeBatch,
  type ItemResult,
} from "@/lib/listing-pipeline";
import { getCatalog } from "@/lib/suppliers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One-click bulk listing from the catalog: the core of the product. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { externalIds?: unknown; engine?: unknown; drip?: unknown };
  const ids = Array.isArray(body.externalIds) ? body.externalIds.filter((id): id is string => typeof id === "string") : [];
  if (!ids.length) {
    return Response.json({ ok: false, error: "Select at least one product to list." }, { status: 400 });
  }
  const drip = body.drip === true;

  const limits = planLimits(user.plan);
  const limitResponse = await checkPlanCapacity(user.id, limits, ids.length, { drip });
  if (limitResponse) return limitResponse;

  const catalog = await getCatalog(200);
  const found = catalog.filter((product) => ids.includes(product.externalId));
  if (!found.length) {
    return Response.json({ ok: false, error: "None of those products are in the catalog." }, { status: 404 });
  }

  // Per-item VeRO gate: brand-name products are skipped, the rest of the batch still goes out.
  const blocked = found.filter((product) => product.veroRisk === "high");
  const selected = found.filter((product) => product.veroRisk !== "high");

  const requested = parseEngine(body.engine);
  const accessToken = await connectedAccessToken(user.id);
  const batchId = randomUUID();

  const results: ItemResult[] = blocked.map((product) => ({
    title: product.title,
    status: "blocked",
    variants: 0,
    message: `Skipped to protect your eBay account: ${product.veroReason}`,
  }));

  results.push(
    ...(await inChunks(selected, 5, (product) =>
      createListing({
        userId: user.id,
        limits,
        source: {
          title: product.title,
          category: product.category,
          supplierPrice: product.supplierPrice,
          listPrice: product.suggestedPrice,
          sourceUrl: product.supplierUrl,
          imageUrl: product.imageUrl,
        },
        requested,
        accessToken,
        drip,
        batchId,
      }),
    )),
  );

  return Response.json(summarizeBatch(batchId, found.length, results));
}
