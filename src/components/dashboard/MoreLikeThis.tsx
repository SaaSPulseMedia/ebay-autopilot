"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type BestSeller = { title: string; sold: number };
type Run =
  | { ok: true; checked: number; ready: number; errors: number }
  | { ok: false; error: string };
type Result =
  | { ok: true; queued: number; query: string; run: Run }
  | { ok: false; error: string };

/**
 * "More like this": pick one of your best sellers (or type a description) and
 * AutoPilot searches CJ for similar products, then checks them the usual way.
 * Those that pass show under "Ready to list".
 */
export function MoreLikeThis() {
  const router = useRouter();
  const [bestSellers, setBestSellers] = useState<BestSeller[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/sourcing/like")
      .then((res) => res.json())
      .then(
        (json: { ok: boolean; bestSellers?: BestSeller[] }) =>
          live && setBestSellers(json.bestSellers ?? []),
      )
      .catch(() => live && setBestSellers([]));
    return () => {
      live = false;
    };
  }, []);

  async function search(title: string) {
    setText(title);
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/sourcing/like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setResult((await res.json()) as Result);
      router.refresh();
    } catch {
      setResult({
        ok: false,
        error: "The search didn't finish. Try again in a minute.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ap-card space-y-3 rounded-2xl p-5">
      <div>
        <h2 className="text-sm font-semibold text-white">More like this</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Pick something that sells for you, or describe it. AutoPilot finds
          similar CJ products and checks each one (real shipping, your real
          fees, eBay prices and demand). The ones that pass appear under Ready
          to list.
        </p>
      </div>
      {bestSellers === null ? (
        <p className="text-xs text-slate-500">Loading your best sellers…</p>
      ) : bestSellers.length ? (
        <div className="flex flex-wrap gap-2">
          {bestSellers.map((b) => (
            <button
              key={b.title}
              type="button"
              onClick={() => void search(b.title)}
              disabled={busy}
              className="max-w-full truncate rounded-full border border-white/15 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
              title={b.title}
            >
              {`${b.title.slice(0, 48)}${b.title.length > 48 ? "…" : ""} · ${b.sold} sold`}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          No sales in the last 90 days to start from: type a description
          instead.
        </p>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void search(text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. denim maxi dress"
          className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
        >
          {busy ? "Searching and checking… (up to a minute)" : "Find similar"}
        </button>
      </form>
      {result ? (
        result.ok ? (
          <p className="rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs text-slate-200">
            {result.queued
              ? `Found ${result.queued} new CJ product${result.queued === 1 ? "" : "s"} for "${result.query}". `
              : `No new CJ products for "${result.query}" (everything found was checked before). `}
            {result.run.ok
              ? `Checked ${result.run.checked}: ${result.run.ready} ready.${result.queued > result.run.checked ? " Press Find similar again to check the rest." : ""}`
              : result.run.error}
          </p>
        ) : (
          <p className="text-xs text-red-300">{result.error}</p>
        )
      ) : null}
    </section>
  );
}
