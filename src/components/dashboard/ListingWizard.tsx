"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ENGINES, type ListingEngine } from "@/lib/ebay/types";

type Props = { initialTitle?: string; initialCost?: number; initialPrice?: number };

type CopyResponse = {
  ok: boolean;
  error?: string;
  product?: { title: string; price: number | null; imageUrl: string | null; note?: string } | null;
  copy?: { title: string; description: string; bullets: string[]; source: string } | null;
};

export function ListingWizard({ initialTitle = "", initialCost = 0, initialPrice = 0 }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(initialTitle ? 2 : 1);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [supplierPrice, setSupplierPrice] = useState(initialCost);
  const [listPrice, setListPrice] = useState(initialPrice);
  const [engine, setEngine] = useState<ListingEngine | "auto">("auto");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function runImport(useUrl: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(useUrl ? { url } : { title }),
      });
      const json = (await res.json()) as CopyResponse;
      if (json.product) {
        if (json.product.title) setTitle(json.product.title);
        if (json.product.price) {
          setSupplierPrice(json.product.price);
          setListPrice(Math.round((json.product.price * 1.55 + 0.4) * 100) / 100);
        }
        if (json.product.imageUrl) setImageUrl(json.product.imageUrl);
        if (json.product.note) setNote(json.product.note);
      }
      if (json.copy) {
        setTitle(json.copy.title);
        setDescription(json.copy.description);
        setNote(
          json.copy.source === "claude"
            ? "Copy drafted by Claude. Edit anything before publishing."
            : "Copy drafted from the built-in template (no AI key configured).",
        );
      }
      if (!json.ok && json.error) setNote(json.error);
      setStep(2);
    } catch {
      setNote("Import failed. Enter the details manually.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, listPrice, supplierPrice, sourceUrl: url || null, imageUrl: imageUrl || null, engine }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; result?: { message: string; engine: string } };
      setResult(json.result?.message ?? json.error ?? "Done.");
      router.refresh();
    } catch {
      setResult("Publish failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const fees = listPrice * 0.1355 + 0.4;
  const net = listPrice - supplierPrice - fees;

  return (
    <div className="space-y-5">
      <ol className="flex gap-2">
        {["Import", "Review copy", "Price & publish"].map((label, index) => (
          <li
            key={label}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm ${
              step === index + 1 ? "border-brand-500/60 bg-brand-500/10 text-white" : "border-white/10 text-slate-400"
            }`}
          >
            <span className="font-semibold">{index + 1}.</span> {label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="ap-card space-y-4 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-white">Start from a supplier URL</h2>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://supplier.com/product/..."
            className="w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || !url}
              onClick={() => runImport(true)}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
            >
              {busy ? "Reading page…" : "Import product"}
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
            >
              Enter manually
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="ap-card space-y-4 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-white">Listing copy</h2>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">eBay title (80 characters max)</span>
            <input
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
            />
            <span className="mt-1 block text-[11px] text-slate-500">{title.length}/80</span>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Description</span>
            <textarea
              value={description}
              rows={8}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || !title}
              onClick={() => runImport(false)}
              className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              {busy ? "Generating…" : "Generate with AI"}
            </button>
            <button
              type="button"
              disabled={!title}
              onClick={() => setStep(3)}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
            >
              Next: pricing
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="ap-card space-y-4 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-white">Pricing and engine</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">Supplier cost ($)</span>
              <input
                type="number"
                step="0.01"
                value={supplierPrice}
                onChange={(e) => setSupplierPrice(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">List price ($)</span>
              <input
                type="number"
                step="0.01"
                value={listPrice}
                onChange={(e) => setListPrice(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
              />
            </label>
          </div>

          <div className="grid gap-3 rounded-xl bg-white/5 p-4 text-sm sm:grid-cols-3">
            <p className="text-slate-400">
              eBay fees <span className="block font-semibold text-white">${fees.toFixed(2)}</span>
            </p>
            <p className="text-slate-400">
              Net profit <span className="block font-semibold text-lime-brand">${net.toFixed(2)}</span>
            </p>
            <p className="text-slate-400">
              Margin{" "}
              <span className="block font-semibold text-white">
                {listPrice > 0 ? ((net / listPrice) * 100).toFixed(1) : "0.0"}%
              </span>
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[11px] uppercase tracking-wide text-slate-400">Publishing engine</legend>
            <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm">
              <input type="radio" checked={engine === "auto"} onChange={() => setEngine("auto")} className="mt-1" />
              <span>
                <span className="block font-medium text-white">Auto</span>
                <span className="block text-xs text-slate-400">
                  Try the eBay API first, then fall back to demo mode for this account.
                </span>
              </span>
            </label>
            {ENGINES.map((option) => (
              <label key={option.id} className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm">
                <input
                  type="radio"
                  checked={engine === option.id}
                  onChange={() => setEngine(option.id)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium text-white">{option.label}</span>
                  <span className="block text-xs text-slate-400">{option.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            disabled={busy || !title}
            onClick={publish}
            className="rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
          >
            {busy ? "Publishing…" : "Publish listing"}
          </button>
        </section>
      ) : null}

      {note ? <p className="rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-slate-300">{note}</p> : null}
      {result ? (
        <p className="rounded-xl border border-lime-brand/30 bg-lime-brand/10 px-4 py-3 text-sm text-lime-brand">{result}</p>
      ) : null}
    </div>
  );
}
