"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BatchSummary, DripToggle, type BatchResponse } from "@/components/dashboard/BatchControls";
import { PriceBreakdown } from "@/components/dashboard/PriceBreakdown";
import { priceBreakdown, priceFromMarkup } from "@/lib/pricing";
import { checkSupplierUrl } from "@/lib/supplier-policy";

type Props = {
  batchSize: number;
  remaining: number;
  dripAllowed: boolean;
  dripPerRun: number;
  defaultMarkupPct: number;
  defaultAdRatePct: number;
};

export function ImportLister({ batchSize, remaining, dripAllowed, dripPerRun, defaultMarkupPct, defaultAdRatePct }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [markupPct, setMarkupPct] = useState(defaultMarkupPct);
  const [adRatePct, setAdRatePct] = useState(defaultAdRatePct);
  const [drip, setDrip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<BatchResponse | null>(null);

  const links = useMemo(
    () => Array.from(new Set(text.split(/[\s,]+/).map((line) => line.trim()).filter(Boolean))),
    [text],
  );
  const checks = useMemo(() => links.map((url) => ({ url, check: checkSupplierUrl(url) })), [links]);
  const refused = checks.filter((row) => !row.check.allowed);
  const warned = checks.filter((row) => row.check.allowed && row.check.warning);
  const cap = Math.min(batchSize, remaining);
  const tooMany = links.length > cap;

  // Worked example so the markup is easy to judge: a $20 supplier item.
  const example = priceBreakdown(priceFromMarkup(20, markupPct), 20, 0, adRatePct);

  async function submit() {
    setBusy(true);
    setSummary(null);
    try {
      const res = await fetch("/api/listings/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: links, markupPct, adRatePct, drip: dripAllowed && drip }),
      });
      const json = (await res.json()) as BatchResponse;
      setSummary(json);
      if (json.ok) {
        setText("");
        router.refresh();
      }
    } catch {
      setSummary({ ok: false, error: "The links could not be sent. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="ap-card space-y-4 rounded-2xl p-5">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            Supplier links — one per line, up to {batchSize} per run
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={"https://your-supplier.com/product/123\nhttps://your-supplier.com/product/456"}
            className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 font-mono text-xs text-white outline-none focus:border-brand-500"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            {links.length} link{links.length === 1 ? "" : "s"} · room for {cap} right now
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Markup on supplier price (%)</span>
            <input
              type="number"
              min={0}
              max={500}
              value={markupPct}
              onChange={(e) => setMarkupPct(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">
              Promoted listing ad rate (%) — 0 if you don&apos;t promote
            </span>
            <input
              type="number"
              min={0}
              max={20}
              step={0.5}
              value={adRatePct}
              onChange={(e) => setAdRatePct(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
            />
          </label>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Example: a $20.00 supplier item at these settings (assumes the supplier price includes shipping)
          </p>
          <div className="mt-1 max-w-md">
            <PriceBreakdown breakdown={example} compact />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Starts from your saved defaults; changes here apply to this run only.{" "}
            <Link href="/dashboard/settings" className="font-semibold text-brand-400 hover:text-brand-500">
              Edit defaults
            </Link>
            . Links that would lose money are skipped.
          </p>
        </div>

        <DripToggle allowed={dripAllowed} checked={drip} perRun={dripPerRun} onChange={setDrip} />

        {refused.length ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
            <p className="font-semibold">These links will be skipped:</p>
            <ul className="mt-1 space-y-1">
              {refused.map(({ url, check }) => (
                <li key={url}>⛔ {check.allowed ? "" : check.reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {warned.length ? (
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-200">
            {warned[0].check.allowed ? warned[0].check.warning : ""}
          </p>
        ) : null}
        {tooMany ? (
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-200">
            You pasted {links.length} links, but you can list {cap} right now. Remove some, or upgrade for more room.
          </p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={busy || !links.length || tooMany || links.length === refused.length}
          className="ap-glow rounded-full bg-brand-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-400 disabled:opacity-50 disabled:shadow-none"
        >
          {busy ? `Reading ${links.length} pages…` : `⚡ ${dripAllowed && drip ? "Schedule" : "List"} ${links.length || ""} link${links.length === 1 ? "" : "s"}`}
        </button>
      </section>

      {summary ? <BatchSummary summary={summary} perRun={dripPerRun} /> : null}
    </div>
  );
}
