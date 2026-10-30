"use client";

import { useEffect, useState } from "react";

type Mode = "off" | "create" | "pay";
type Settings = {
  mode: Mode;
  maxOrder: number;
  maxDay: number;
  enabledAt: string | null;
};
type Info = {
  settings: Settings;
  canPay: boolean;
  balance: number | null;
  balanceError: string | null;
};
type Run = {
  ordered: number;
  paid: number;
  held: number;
  skipped: number;
  errors: number;
};

const money = (n: number) => `$${n.toFixed(2)}`;

const MODES: Array<{ mode: Mode; label: string; text: string }> = [
  {
    mode: "off",
    label: "Off",
    text: "You order every sale yourself with Fulfill on CJ.",
  },
  {
    mode: "create",
    label: "Create and check",
    text: "Every hour, each new sale of a CJ product is ordered on CJ for you: the buyer's address from eBay, the exact size and colour, CJ's cheapest shipping. You only press Pay in CJ.",
  },
  {
    mode: "pay",
    label: "Create and pay from my CJ wallet",
    text: "The same, then paid from your CJ wallet when every check passes: the sale doesn't lose money, the order is within your limits, and the wallet has enough. Tracking goes on eBay when CJ ships.",
  },
];

/** Automatic ordering on CJ for new eBay sales: the mode, the payment limits and the CJ wallet balance. */
export function AutoOrdering({ onRun }: { onRun?: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [mode, setMode] = useState<Mode>("off");
  const [maxOrder, setMaxOrder] = useState("40");
  const [maxDay, setMaxDay] = useState("150");
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function apply(next: Info) {
    setInfo(next);
    setMode(next.settings.mode);
    setMaxOrder(String(next.settings.maxOrder));
    setMaxDay(String(next.settings.maxDay));
  }

  useEffect(() => {
    let live = true;
    fetch("/api/fulfillment/auto")
      .then((res) => res.json())
      .then((json: Info & { ok: boolean }) => live && json.ok && apply(json))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch("/api/fulfillment/auto", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          maxOrder: Number(maxOrder),
          maxDay: Number(maxDay),
        }),
      });
      const json = (await res.json()) as Info & { ok: boolean; error?: string };
      if (!json.ok) {
        setMessage(json.error ?? "Couldn't save. Try again.");
        return;
      }
      apply(json);
      setMessage(
        json.settings.mode === "off"
          ? "Saved: automatic ordering is off."
          : "Saved. From now on, new sales of CJ products are ordered within the hour. Sales from before now are left to you.",
      );
    } catch {
      setMessage("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy("run");
    setMessage(null);
    try {
      const res = await fetch("/api/fulfillment/auto", { method: "POST" });
      const json = (await res.json()) as {
        ok: boolean;
        run?: Run;
        error?: string;
      };
      const r = json.run;
      setMessage(
        !json.ok || !r
          ? (json.error ?? "The run didn't finish. Try again.")
          : r.ordered || r.held || r.errors
            ? `Ordered ${r.ordered} on CJ${r.paid ? ` (${r.paid} paid from your wallet)` : ""}${r.held ? `, ${r.held} left for you` : ""}${r.errors ? `, ${r.errors} couldn't be done right now` : ""}. Details are on each order below.`
            : "No new sales of CJ products to order right now.",
      );
      onRun?.();
    } catch {
      setMessage("The run didn't finish. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!info) return null;
  const dirty =
    mode !== info.settings.mode ||
    Number(maxOrder) !== info.settings.maxOrder ||
    Number(maxDay) !== info.settings.maxDay;

  return (
    <section className="ap-card space-y-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Automatic ordering on CJ
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {info.settings.mode === "off"
              ? "Off."
              : `On since ${new Date(info.settings.enabledAt ?? Date.now()).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}: only sales after that are ordered.`}
          </p>
        </div>
        {info.canPay ? (
          <p className="text-xs text-slate-300">
            CJ wallet:{" "}
            <span className="font-semibold text-white">
              {info.balance != null ? money(info.balance) : "—"}
            </span>
            {info.balanceError ? (
              <span className="text-amber-200">{` (${info.balanceError})`}</span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        {MODES.filter((m) => m.mode !== "pay" || info.canPay).map((m) => (
          <label
            key={m.mode}
            className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${mode === m.mode ? "border-brand-500 bg-brand-500/10" : "border-white/10"}`}
          >
            <input
              type="radio"
              name="auto-mode"
              checked={mode === m.mode}
              onChange={() => setMode(m.mode)}
              className="mt-1 accent-brand-500"
            />
            <span>
              <span className="font-semibold text-white">{m.label}</span>
              <span className="mt-0.5 block text-xs text-slate-400">
                {m.text}
              </span>
            </span>
          </label>
        ))}
      </div>

      {mode === "pay" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-300">
            Most one order may cost (USD)
            <input
              type="number"
              min={5}
              step={1}
              value={maxOrder}
              onChange={(e) => setMaxOrder(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-300">
            Most paid automatically in 24 hours (USD)
            <input
              type="number"
              min={5}
              step={1}
              value={maxDay}
              onChange={(e) => setMaxDay(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>
      ) : null}

      {mode !== "off" ? (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          While this is on, don&apos;t order new CJ sales by hand (Buy sample)
          before AutoPilot has had its hourly turn, or the item is bought twice.
          Orders it can&apos;t do safely are marked{" "}
          <span className="font-semibold">Needs you</span> below, with the
          reason.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null || !dirty}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {info.settings.mode !== "off" ? (
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={busy !== null}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
          >
            {busy === "run"
              ? "Ordering… (up to a minute)"
              : "Order new sales now"}
          </button>
        ) : null}
        {message ? (
          <span className="text-xs text-slate-300">{message}</span>
        ) : null}
      </div>
    </section>
  );
}
