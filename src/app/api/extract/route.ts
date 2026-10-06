import { getCurrentUser } from "@/lib/auth";
import { generateListingCopy } from "@/lib/ai";
import { extractProduct } from "@/lib/product-extract";
import { checkSupplierUrl } from "@/lib/supplier-policy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { url?: string; title?: string; withCopy?: boolean };

  if (body.url) {
    const supplier = checkSupplierUrl(body.url);
    if (!supplier.allowed) {
      return Response.json({ ok: false, code: "supplier_blocked", error: supplier.reason }, { status: 422 });
    }
    const extracted = await extractProduct(body.url);
    const product = supplier.warning
      ? { ...extracted, note: [extracted.note, supplier.warning].filter(Boolean).join(" ") }
      : extracted;
    const copy = product.ok
      ? await generateListingCopy({ title: product.title, listPrice: product.price ?? undefined })
      : null;
    return Response.json({ ok: product.ok, product, copy });
  }

  if (body.title) {
    const copy = await generateListingCopy({ title: body.title });
    return Response.json({ ok: true, product: null, copy });
  }

  return Response.json({ ok: false, error: "Provide a supplier URL or a product title." }, { status: 400 });
}
