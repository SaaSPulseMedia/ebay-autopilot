"use client";

import { useEffect, useState } from "react";

type Run = { restocked: number; skipped: number; failed: number };

/** "Put sold sizes and colours back in stock": the switch, and a run-now button. */
export function RestockToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/restock")
      .then((res) => res.json())
      .then((json: { ok: boolean; restock?: boolean }) => live && json.ok && setOn(Boolean(json.restock)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/restock", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ restock: next }) });
      const json = (await res.json().catch(() => null)) as { ok: boolean; restock?: boolean; error?: string } | null;
      if (!json?.ok) {
        setMessage(json?.error ?? `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      setOn(Boolean(json.restock));
      if (!json.restock) {
        setMessage("Off.");
        return;
      }
      // Switched on: the last 3 days' sales are restocked straight away.
      const ran = await fetch("/api/restock", { method: "POST" });
      const result = (await ran.json().catch(() => null)) as { ok: boolean; run?: Run } | null;
      const r = result?.run;
      setMessage(
        r
          ? `On. ${r.restocked ? `${r.restocked} sold size/colour${r.restocked === 1 ? "" : "s"} put back in stock just now. ` : "Nothing to restock right now. "}From now on, every hour.${r.failed ? ` ${r.failed} couldn't be restocked (see the listing on eBay).` : ""}`
          : "On. From now on, every hour.",
      );
    } catch {
      setMessage("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (on === null) return null;
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-sm text-slate-200">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} className="mt-1 h-4 w-4 accent-brand-500" />
        <span>
          Put sold sizes and colours back in stock
          <span className="block text-xs text-slate-400">
            After each sale, that exact variant goes back to your quantity per variant (Settings → Listing defaults), within the hour.
            AutoPilot&apos;s own listings only; listings made directly on eBay aren&apos;t touched.
          </span>
        </span>
      </label>
      {busy ? <p className="text-xs text-slate-400">Saving and restocking recent sales…</p> : message ? <p className="text-xs text-slate-300">{message}</p> : null}
    </div>
  );
}
