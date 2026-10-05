"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ListingRow = {
  id: number;
  title: string;
  supplierPrice: string;
  listPrice: string;
  variantCount: number;
  engine: string;
  status: string;
  ebayItemId: string | null;
  createdAt: Date | string;
};

export function ListingsTable({ initialListings }: { initialListings: ListingRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState<ListingRow[]>(initialListings);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function endListing(id: number) {
    if (!confirm("End this listing? It will no longer count against your active plan limit.")) return;
    setBusyId(id);
    try {
      const res = await fetch("/api/listings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "end" }),
      });
      const data = await res.json();
      if (data.ok) {
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: "ended" } : item)));
        router.refresh();
      } else {
        alert(data.error ?? "Could not end listing.");
      }
    } catch {
      alert("Error ending listing.");
    } finally {
      setBusyId(null);
    }
  }

  if (!items.length) {
    return (
      <p className="ap-card rounded-2xl p-10 text-center text-sm text-slate-400">
        No listings yet. Start from the research feed or paste a supplier URL in the wizard.
      </p>
    );
  }

  return (
    <div className="ap-card overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3 text-right">Cost</th>
            <th className="px-4 py-3 text-right">Price</th>
            <th className="px-4 py-3 text-right">Variants</th>
            <th className="px-4 py-3">Engine</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">eBay item</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
              <td className="max-w-[300px] truncate px-4 py-3 font-medium text-white">{row.title}</td>
              <td className="px-4 py-3 text-right text-slate-300">${Number(row.supplierPrice).toFixed(2)}</td>
              <td className="px-4 py-3 text-right font-semibold text-white">${Number(row.listPrice).toFixed(2)}</td>
              <td className="px-4 py-3 text-right text-slate-300">{row.variantCount}</td>
              <td className="px-4 py-3 text-slate-300">{row.engine}</td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${
                    row.status === "active"
                      ? "bg-lime-brand/15 text-lime-brand border border-lime-brand/30"
                      : row.status === "queued"
                      ? "bg-brand-500/15 text-brand-400 border border-brand-500/30"
                      : row.status === "ended"
                      ? "bg-slate-700/40 text-slate-400 border border-slate-600/30"
                      : "bg-white/8 text-slate-300"
                  }`}
                >
                  {row.status}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-400 font-mono text-xs">{row.ebayItemId ?? "—"}</td>
              <td className="px-4 py-3 text-right">
                {row.status !== "ended" ? (
                  <button
                    type="button"
                    onClick={() => endListing(row.id)}
                    disabled={busyId === row.id}
                    className="rounded-full border border-red-500/30 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {busyId === row.id ? "Ending…" : "End listing"}
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">Ended</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
