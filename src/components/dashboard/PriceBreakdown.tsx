import type { PriceBreakdown as Breakdown } from "@/lib/pricing";

const money = (value: number) => `$${value.toFixed(2)}`;

/** "Why this price": every line between the list price and what the seller keeps. */
export function PriceBreakdown({ breakdown, compact = false }: { breakdown: Breakdown; compact?: boolean }) {
  const rows: { label: string; value: number; minus?: boolean; hide?: boolean }[] = [
    { label: "List price", value: breakdown.listPrice },
    { label: "Supplier cost", value: breakdown.cost, minus: true },
    { label: "Shipping to buyer", value: breakdown.shipping, minus: true, hide: breakdown.shipping === 0 },
    { label: "eBay final value fee (13.55%)", value: breakdown.finalValueFee, minus: true },
    { label: "eBay per-order fee", value: breakdown.fixedFee, minus: true },
    { label: "Promoted listing ad fee", value: breakdown.adFee, minus: true, hide: breakdown.adFee === 0 },
  ];
  const loses = breakdown.profit <= 0;

  return (
    <div className={`rounded-xl bg-white/5 ${compact ? "px-3 py-2 text-xs" : "p-4 text-sm"}`}>
      <dl className="space-y-1">
        {rows
          .filter((row) => !row.hide)
          .map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-slate-400">{row.label}</dt>
              <dd className={row.minus ? "text-slate-300" : "font-semibold text-white"}>
                {row.minus ? "− " : ""}
                {money(row.value)}
              </dd>
            </div>
          ))}
        <div className="flex justify-between gap-4 border-t border-white/10 pt-1">
          <dt className="font-semibold text-white">You keep</dt>
          <dd className={`font-semibold ${loses ? "text-red-300" : "text-lime-brand"}`}>
            {money(breakdown.profit)} <span className="font-normal text-slate-400">({breakdown.marginPct}%)</span>
          </dd>
        </div>
      </dl>
      {loses ? <p className="mt-2 text-red-300">This price loses money after eBay fees. Raise your price or markup.</p> : null}
    </div>
  );
}
