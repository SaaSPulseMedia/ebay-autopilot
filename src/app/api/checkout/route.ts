import { getCurrentUser } from "@/lib/auth";
import { createCheckoutSession } from "@/lib/billing";
import type { Plan } from "@/lib/plans";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { plan?: string };
  const plan = (["starter", "pro", "business"].includes(body.plan ?? "") ? body.plan : "pro") as Plan["id"];

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(request.url).origin;
  const session = await createCheckoutSession(plan, baseUrl);

  return Response.json({ ok: true, ...session });
}
