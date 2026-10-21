import "server-only";

import { refreshCjShipping } from "@/lib/cj/catalog";
import { cjPidOf } from "@/lib/cj/urls";
import type { CatalogProduct } from "@/lib/suppliers";

/**
 * A catalog product with its real CJ shipping cost, ready to price. Products
 * imported before real quotes were stored (shippingQuoted false) are quoted
 * now and saved; when CJ can't quote one, it must not be listed, so this
 * returns an error instead of falling back to a guess.
 */
export async function withRealShipping(
  userId: number,
  product: CatalogProduct,
): Promise<{ ok: true; product: CatalogProduct } | { ok: false; error: string }> {
  if (product.shippingQuoted) return { ok: true, product };
  if (!cjPidOf(product.externalId)) {
    return { ok: false, error: "No real shipping cost for this product, so it can't be priced safely." };
  }
  const quote = await refreshCjShipping(userId, product);
  if (!quote.ok) return { ok: false, error: quote.error };
  return {
    ok: true,
    product: { ...product, shippingCost: quote.data.shipping, suggestedPrice: quote.data.suggested, shippingQuoted: true },
  };
}
