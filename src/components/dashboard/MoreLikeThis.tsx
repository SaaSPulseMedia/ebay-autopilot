"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { type ReadyProduct, ReadyCard } from "@/components/dashboard/ReadyCard";
import { REJECT_REASONS, type RejectReason } from "@/lib/sourcing-reasons";

type BestSeller = { title: string; sold: number };
type Similar = { status: "queued" | "ready" | "rejected"; product: ReadyProduct; reason: RejectReason | null; detail: string };
type Reply = { ok: true; query: string; queued: number; runError: string | null; results: Similar[] } | { ok: false; error: string };

/** Rounds of checking after the search (each ~50 s, about 6 products). */
const MAX_ROUNDS = 5;

/**
 * "More like this": pick a best seller (or describe a product); AutoPilot
 * searches CJ for similar products and keeps checking them, round after
 * round, showing each one's result right here.
 */
export function MoreLikeThis({ ebayConnected }: { ebayConnected: boolean }) {
  const router = useRouter();
  const [bestSellers, setBestSellers] = useState<BestSeller[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<Similar[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    let live = true;
    fetch("/api/sourcing/like")
      .then((res) => res.json())
      .then((json: { ok: boolean; bestSellers?: BestSeller[] }) => live && setBestSellers(json.bestSellers ?? []))
      .catch(() => live && setBestSellers([]));
    return () => {
      live = false;
    };
  }, []);

  async function post(title: string, again: boolean): Promise<Reply> {
    try {
      const res = await fetch("/api/sourcing/like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, again }),
      });
      return (await res.json()) as Reply;
    } catch {
      return { ok: false, error: "The connection dropped. Press Find similar to carry on." };
    }
  }

  async function search(title: string) {
    setText(title);
    setBusy(true);
    setError(null);
    setResults([]);
    setQuery(null);
    setMessage("Searching CJ and checking the first products… (about a minute)");
    stopRef.current = false;
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const reply = await post(title, round > 0);
      if (!reply.ok) {
        setError(reply.error);
        break;
      }
      setQuery(reply.query);
      setResults(reply.results);
      const waiting = reply.results.filter((r) => r.status === "queued").length;
      if (!reply.results.length) {
        setMessage(`CJ has nothing new for "${reply.query}". Try other words, e.g. a shorter description.`);
        break;
      }
      if (reply.runError) {
        setError(reply.runError);
        break;
      }
      if (!waiting || stopRef.current) {
        setMessage(waiting ? `Stopped. ${waiting} still to check: press Find similar to carry on.` : "All checked.");
        break;
      }
      setMessage(`Checked ${reply.results.length - waiting} of ${reply.results.length}. Checking the rest… (about a minute per 6)`);
    }
    setBusy(false);
    router.refresh();
  }

  const ready = results.filter((r) => r.status === "ready");
  const rejected = results.filter((r) => r.status === "rejected");

  return (
    <section className="ap-card space-y-4 rounded-2xl p-5">
      <div>
        <h2 className="text-sm font-semibold text-white">More like this</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          1. Click one of your best sellers below, or type a short description (e.g. <span className="text-slate-200">denim maxi dress</span>) and press Find similar.
          2. AutoPilot finds up to 20 similar CJ products and checks each one with your real fees, CJ&apos;s real shipping and eBay&apos;s
          prices. 3. The ones that pass show up right here, with a List on eBay button.
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
        <p className="text-xs text-slate-500">No live best sellers from the last 90 days to start from: type a description instead.</p>
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
          {busy ? "Working…" : "Find similar"}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={() => (stopRef.current = true)}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
          >
            Stop
          </button>
        ) : null}
      </form>
      {message ? <p className="text-xs text-slate-300">{message}</p> : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}

      {query && results.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-white">{`Results for "${query}": ${ready.length} ready to list`}</h3>
          {ready.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ready.map((r) => (
                <ReadyCard key={r.product.pid} product={r.product} ebayConnected={ebayConnected} />
              ))}
            </div>
          ) : busy ? null : (
            <p className="text-xs text-slate-400">None passed the checks this time. The reasons are below: try different words.</p>
          )}
          {rejected.length ? (
            <details className="rounded-xl border border-white/10 p-3">
              <summary className="cursor-pointer text-xs text-slate-300">{`${rejected.length} turned down, and why`}</summary>
              <ul className="mt-2 divide-y divide-white/8">
                {rejected.map((r) => (
                  <li key={r.product.pid} className="min-w-0 py-2 text-xs">
                    <p className="truncate text-slate-200">{r.product.title}</p>
                    <p className="text-amber-200">{r.reason ? (REJECT_REASONS[r.reason] ?? r.reason) : "Turned down"}</p>
                    {r.detail ? <p className="text-slate-500">{r.detail}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
