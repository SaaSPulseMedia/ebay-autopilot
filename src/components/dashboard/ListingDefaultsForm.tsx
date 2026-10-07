"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PriceBreakdown } from "@/components/dashboard/PriceBreakdown";
import {
  FOOTER_MAX,
  HANDLING_OPTIONS,
  handlingLabel,
  normalizeDefaults,
  type ListingDefaults,
} from "@/lib/listing-defaults";
import { listPriceFor, priceBreakdown, priceForEbay } from "@/lib/pricing";

const FOOTER_EXAMPLE = `Shipping: dispatched within 2 business days with tracking.
Returns: 30-day returns accepted.
Questions? Send us a message through eBay and we will reply within 24 hours.`;

const field =
  "mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500";
const label = "text-[11px] uppercase tracking-wide text-slate-400";

export function ListingDefaultsForm({ initial }: { initial: ListingDefaults }) {
  const router = useRouter();
  const [values, setValues] = useState<ListingDefaults>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function set<K extends keyof ListingDefaults>(key: K, value: ListingDefaults[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }

  // Worked example on a $20 supplier item, using the same maths as real listings.
  const example = normalizeDefaults(values);
  const { shipping, suggested } = priceForEbay(20);
  const exampleBreakdown = priceBreakdown(listPriceFor(example, 20, shipping, suggested), 20, shipping, example.adRatePct);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/listing", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; defaults?: ListingDefaults };
      if (json.ok && json.defaults) {
        setValues(json.defaults);
        setMessage({ ok: true, text: "Saved. New listings will use these defaults." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: json.error ?? "Could not save." });
      }
    } catch {
      setMessage({ ok: false, text: "Could not save. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ap-card space-y-5 rounded-2xl p-6">
      <div>
        <h2 className="text-base font-semibold text-white">Listing defaults</h2>
        <p className="mt-1 text-sm text-slate-400">
          Set these once. They are used for every new listing — Bulk list, Paste links, and New listing.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>How should we price your listings?</legend>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm">
          <input
            type="radio"
            className="mt-1"
            checked={values.pricingMode === "suggested"}
            onChange={() => set("pricingMode", "suggested")}
          />
          <span>
            <span className="block font-medium text-white">Use AutoPilot&apos;s suggested price</span>
            <span className="block text-xs text-slate-400">Aims for about 23% profit after eBay fees.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm">
          <input
            type="radio"
            className="mt-1"
            checked={values.pricingMode === "markup"}
            onChange={() => set("pricingMode", "markup")}
          />
          <span className="flex-1">
            <span className="block font-medium text-white">Use my own markup</span>
            <span className="block text-xs text-slate-400">Added on top of the supplier cost plus shipping.</span>
            {values.pricingMode === "markup" ? (
              <span className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={values.markupPct}
                  onChange={(e) => set("markupPct", Number(e.target.value))}
                  className="w-24 rounded-lg border border-white/15 bg-navy-900 px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500"
                />
                <span className="text-xs text-slate-400">% markup</span>
              </span>
            ) : null}
          </span>
        </label>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={label}>Promoted listing ad rate (%)</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.5}
            value={values.adRatePct}
            onChange={(e) => set("adRatePct", Number(e.target.value))}
            className={field}
          />
          <span className="mt-1 block text-[11px] text-slate-500">0 if you don&apos;t promote.</span>
        </label>
        <label className="block">
          <span className={label}>Quantity per variant</span>
          <input
            type="number"
            min={1}
            max={100}
            value={values.quantityPerVariant}
            onChange={(e) => set("quantityPerVariant", Number(e.target.value))}
            className={field}
          />
          <span className="mt-1 block text-[11px] text-slate-500">How many of each size/colour to offer.</span>
        </label>
        <label className="block">
          <span className={label}>Handling time</span>
          <select
            value={values.handlingDays}
            onChange={(e) => set("handlingDays", Number(e.target.value))}
            className={field}
          >
            {HANDLING_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {handlingLabel(days)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-slate-500">Saved now, sent to eBay once your store is connected.</span>
        </label>
      </div>

      <label className="block">
        <span className={label}>Footer added to every listing description</span>
        <textarea
          value={values.descriptionFooter}
          maxLength={FOOTER_MAX}
          rows={5}
          placeholder={FOOTER_EXAMPLE}
          onChange={(e) => set("descriptionFooter", e.target.value)}
          className={field}
        />
        <span className="mt-1 flex justify-between text-[11px] text-slate-500">
          <span>Your shipping, returns, and contact details. Only promise what you actually offer.</span>
          <span>
            {values.descriptionFooter.length}/{FOOTER_MAX}
          </span>
        </span>
      </label>

      <div>
        <p className={label}>Example: a $20.00 supplier item with these settings</p>
        <div className="mt-1 max-w-md">
          <PriceBreakdown breakdown={exampleBreakdown} compact />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-full bg-brand-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save defaults"}
        </button>
        {message ? (
          <span className={`text-sm ${message.ok ? "text-lime-brand" : "text-red-300"}`}>{message.text}</span>
        ) : null}
      </div>
    </section>
  );
}
