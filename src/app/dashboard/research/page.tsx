import Link from "next/link";

import { getCatalog, isSampleProduct, marginPct, netProfit } from "@/lib/suppliers";

export const dynamic = "force-dynamic";

export const metadata = { title: "Research" };

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const all = await getCatalog(60);
  const categories = Array.from(new Set(all.map((p) => p.category))).sort();

  const query = (params.q ?? "").toLowerCase();
  const products = all
    .filter((p) => (params.category ? p.category === params.category : true))
    .filter((p) => (query ? p.title.toLowerCase().includes(query) : true))
    .sort((a, b) => marginPct(b) - marginPct(a));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Winning-product research</h1>
        <p className="mt-1 text-sm text-slate-400">
          Supplier cost, suggested eBay price, and net profit after the 13.55% final value fee and the $0.40 per-order
          fee. Sorted by net margin. Every product name is checked for brands that remove unauthorized eBay listings
          (VeRO).
        </p>
        {all.some(isSampleProduct) ? (
          <p className="mt-3 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs text-slate-300">
            These are starter products with <span className="text-white">example supplier prices</span>, not live
            quotes. Check the real cost with your supplier before you list.
          </p>
        ) : null}
      </div>

      <form className="ap-card flex flex-wrap items-end gap-3 rounded-2xl p-4" action="/dashboard/research">
        <label className="flex-1 min-w-[200px]">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Search</span>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Keyword"
            className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
          />
        </label>
        <label className="min-w-[180px]">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Category</span>
          <select
            name="category"
            defaultValue={params.category ?? ""}
            className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400">
          Filter
        </button>
        <span className="pb-2 text-xs text-slate-500">{products.length} products</span>
      </form>

      <div className="ap-card overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[840px] text-left text-sm">
          <thead className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">List at</th>
              <th className="px-4 py-3 text-right">Net profit</th>
              <th className="px-4 py-3 text-right">Margin</th>
              <th className="px-4 py-3">Competition</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.externalId} className="border-b border-white/5 last:border-0">
                <td className="max-w-[280px] px-4 py-3">
                  <span className="block truncate font-medium text-white">{product.title}</span>
                  <span className="block text-[11px] text-slate-500">
                    {product.category}
                    {product.veroRisk === "high" ? (
                      <span title={product.veroReason} className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
                        Brand blocked
                      </span>
                    ) : product.veroRisk === "medium" ? (
                      <span title={product.veroReason} className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-200">
                        {product.veroMatch ? "Brand mentioned" : "Brand-sensitive"}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">{product.supplier}</td>
                <td className="px-4 py-3 text-right text-slate-300">${product.supplierPrice.toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-semibold text-white">${product.suggestedPrice.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-lime-brand">${netProfit(product).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-slate-200">{marginPct(product).toFixed(1)}%</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] uppercase tracking-wide text-slate-300">
                    {product.competition}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {product.veroRisk === "high" ? (
                    <span className="text-xs text-slate-500">Not listable</span>
                  ) : (
                  <Link
                    href={`/dashboard/listings/new?title=${encodeURIComponent(product.title)}&cost=${product.supplierPrice}&price=${product.suggestedPrice}`}
                    className="rounded-full bg-brand-500/15 px-3 py-1.5 text-xs font-semibold text-brand-400 hover:bg-brand-500/25"
                  >
                    List it
                  </Link>
                  )}
                </td>
              </tr>
            ))}
            {!products.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                  No products match that filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
