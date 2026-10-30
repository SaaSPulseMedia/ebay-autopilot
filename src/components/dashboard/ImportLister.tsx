"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BatchSummary, DripToggle, type BatchResponse } from "@/components/dashboard/BatchControls";
import { PriceBreakdown } from "@/components/dashboard/PriceBreakdown";
import { landedCost, realBreakdown, saleFeePct } from "@/lib/listing-defaults";
import { MIN_PROFIT_LABEL, listPriceFor } from "@/lib/pricing";
import { checkSupplierUrl } from "@/lib/supplier-policy";

type Props = {
  batchSize: number;
  remaining: number;
  dripAllowed: boolean;
  dripPerRun: number;
  defaultMarkupPct: number;
  defaultAdRatePct: number;
  /** The seller's real eBay fee rate and currency conversion (Settings), as the server prices with. */
  ebayFeePct: number;
  fxPct: number;
};

export function ImportLister({ batchSize, remaining, dripAllowed, dripPerRun, defaultMarkupPct, defaultAdRatePct, ebayFeePct, fxPct }: Props) {
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

  // Worked example so the markup is easy to judge: a $20 CJ item with $5 shipping, priced like a real link
  // (with the seller's real eBay fees and currency conversion, as the server does).
  const fees = { adRatePct, ebayFeePct, fxPct };
  const examplePrice = listPriceFor({ pricingMode: "markup", markupPct, adRatePct: saleFeePct(fees) }, landedCost(fees, 20), landedCost(fees, 5), 0);
  const example = realBreakdown(fees, examplePrice, 20, 5);

  async function submit(listAnywayUrl?: string) {
    setBusy(true);
    setSummary(null);
    try {
      const res = await fetch("/api/listings/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          listAnywayUrl
            ? { urls: [listAnywayUrl], markupPct, adRatePct, drip: false, allowAboveMarket: true }
            : { urls: links, markupPct, adRatePct, drip: dripAllowed && drip },
        ),
      });
      const json = (await res.json().catch(() => null)) as BatchResponse | null;
      if (!json) {
        // No answer in time (Vercel stops a request after a minute): the listing may still have gone out.
        setSummary({
          ok: false,
          error: `AutoPilot took too long to answer (HTTP ${res.status}). The listing may still have been published: check your Listings page before trying again.`,
        });
        return;
      }
      setSummary(json);
      if (json.ok) {
        setText("");
        router.refresh();
      }
    } catch {
      setSummary({ ok: false, error: "The connection to AutoPilot dropped before it answered (it may have taken too long). Check your Listings page before trying again: the listing may still have been published." });
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
            placeholder={"https://cjdropshipping.com/product/…-p-1234567890.html\nhttps://cjdropshipping.com/product/…-p-0987654321.html"}
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
            Example: a $20.00 CJ item with $5.00 CJ shipping at these settings
          </p>
          <div className="mt-1 max-w-md">
            <PriceBreakdown breakdown={example} compact />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Starts from your saved defaults; changes here apply to this run only.{" "}
            <Link href="/dashboard/settings" className="font-semibold text-brand-400 hover:text-brand-500">
              Edit defaults
            </Link>
            . Prices are raised to keep at least {`${MIN_PROFIT_LABEL} profit; `}ones that would then be more than 20% above the
            eBay average are skipped.
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
          onClick={() => void submit()}
          disabled={busy || !links.length || tooMany || links.length === refused.length}
          className="ap-glow rounded-full bg-brand-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-400 disabled:opacity-50 disabled:shadow-none"
        >
          {busy ? `Reading ${links.length} pages…` : `⚡ ${dripAllowed && drip ? "Schedule" : "List"} ${links.length || ""} link${links.length === 1 ? "" : "s"}`}
        </button>
      </section>

      {summary ? <BatchSummary summary={summary} perRun={dripPerRun} busy={busy} onListAnyway={(url) => void submit(url)} /> : null}
    </div>
  );
}
