"use client";

import { useCallback, useEffect, useState } from "react";

import type { CjMatch } from "@/lib/order-fulfillment";

type Line = { lineItemId: string; title: string; variation: string; quantity: number; match: CjMatch | null };
type Shipping = { method: string; price: number; days: string; from: "CN" | "US" };
type Record = {
  status: string;
  cjOrderId: string | null;
  sandbox: boolean;
  logisticName: string | null;
  amount: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  error: string | null;
};

type Loaded = { lines: Line[]; shipping: Shipping[]; shippingError: string | null; record: Record | null };

const money = (n: number) => (n === 0 ? "free" : `$${n.toFixed(2)}`);

/** What each stored status means for the seller, and what happens next. */
function statusText(r: Record) {
  const test = r.sandbox ? "Test order (CJ won't charge or ship it). " : "";
  switch (r.status) {
    case "created":
      return `${test}Created on CJ${r.amount ? ` (${"$"}${r.amount})` : ""}. Next: pay it in CJ → My CJ → Orders. AutoPilot then adds the tracking to eBay by itself.`;
    case "paid":
      return `${test}Paid on CJ, waiting for CJ to ship. Tracking goes to eBay automatically (checked every hour).`;
    case "shipped":
      return `${test}Shipped: tracking ${r.trackingNumber}.${r.sandbox ? "" : " Sending it to eBay…"}`;
    case "tracking_sent":
      return `Done: tracking ${r.trackingNumber} (${r.carrier}) is on the eBay order, marked shipped.`;
    case "cancelled":
      return "This CJ order was cancelled. You can create a new one below.";
    default:
      return "Not created on CJ.";
  }
}

/**
 * "Order automatically on CJ": AutoPilot creates the CJ order with the buyer's
 * address, the variant bought and the chosen shipping. It never pays: the
 * seller pays in CJ. Tracking then goes to eBay on its own.
 */
export function AutoOrderOnCj({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skus, setSkus] = useState<{ [lineItemId: string]: string }>({});
  const [method, setMethod] = useState<string>("");
  const [sandbox, setSandbox] = useState(false);
  const [busy, setBusy] = useState<"placing" | "checking" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/fulfillment?orderId=${encodeURIComponent(orderId)}`);
      const json = (await res.json()) as Loaded & { ok: boolean; error?: string };
      if (!json.ok) {
        setLoadError(json.error ?? "Couldn't prepare the CJ order.");
        return;
      }
      setData(json);
      setSkus(Object.fromEntries(json.lines.filter((l) => l.match?.cjSku).map((l) => [l.lineItemId, l.match?.cjSku ?? ""])));
      const first = json.shipping[0];
      setMethod(first ? `${first.from}|${first.method}` : "");
    } catch {
      setLoadError("Couldn't reach AutoPilot. Try again.");
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function place() {
    if (!data) return;
    const [from, ...name] = method.split("|");
    setBusy("placing");
    setMessage(null);
    try {
      const res = await fetch("/api/fulfillment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ebayOrderId: orderId, skus, logisticName: name.join("|"), fromCountryCode: from, sandbox }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; warnings?: string[] };
      setMessage(
        json.ok
          ? { tone: "ok", text: `CJ order created${sandbox ? " (test)" : ""}.${json.warnings?.length ? ` CJ notes: ${json.warnings.join("; ")}` : ""}` }
          : { tone: "bad", text: json.error ?? "CJ didn't take the order." },
      );
      await load();
      onChanged();
    } catch {
      setMessage({ tone: "bad", text: "The request didn't finish. Check CJ → My CJ → Orders before trying again." });
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy("checking");
    setMessage(null);
    try {
      await fetch("/api/fulfillment/sync", { method: "POST" });
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
        {loadError}{" "}
        <button type="button" onClick={() => void load()} className="underline">
          Try again
        </button>
      </p>
    );
  }
  if (!data) return <p className="text-sm text-slate-400">Getting the CJ variants and shipping methods… (up to 10 s)</p>;

  const record = data.record;
  const active = record && !record.sandbox && record.status !== "error" && record.status !== "cancelled";
  const unmatched = data.lines.filter((l) => !l.match);
  const ready = !unmatched.length && data.lines.every((l) => skus[l.lineItemId]) && Boolean(method);

  return (
    <div className="space-y-3">
      {record ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            record.status === "error"
              ? "border-red-400/30 bg-red-400/10 text-red-200"
              : "border-lime-brand/30 bg-lime-brand/10 text-lime-brand"
          }`}
        >
          <p>{record.status === "error" ? `Last try failed: ${record.error}` : statusText(record)}</p>
          {record.status !== "error" && record.error ? <p className="mt-1 text-amber-200">{record.error}</p> : null}
          {record.cjOrderId ? <p className="mt-1 text-xs opacity-80">{`CJ order ${record.cjOrderId}${record.logisticName ? ` · ${record.logisticName}` : ""}`}</p> : null}
          {["created", "paid", "shipped"].includes(record.status) ? (
            <button
              type="button"
              onClick={() => void check()}
              disabled={busy !== null}
              className="mt-2 rounded-full border border-current px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              {busy === "checking" ? "Checking CJ…" : "Check CJ now"}
            </button>
          ) : null}
        </div>
      ) : null}

      {active ? null : (
        <>
          {unmatched.length ? (
            <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              {`"${unmatched[0].title}" isn't matched to a CJ product, so this order can't be created automatically. Use the manual steps below.`}
            </p>
          ) : (
            <>
              {data.lines.map((line) =>
                line.match && !line.match.cjSku ? (
                  <label key={line.lineItemId} className="block text-sm text-slate-300">
                    {`CJ variant for "${line.title}"${line.variation ? ` (buyer chose ${line.variation})` : ""}:`}
                    <select
                      value={skus[line.lineItemId] ?? ""}
                      onChange={(e) => setSkus((s) => ({ ...s, [line.lineItemId]: e.target.value }))}
                      className="mt-1 block w-full rounded-lg border border-white/15 bg-navy-950 px-2 py-1.5 text-sm text-white"
                    >
                      <option value="">Pick the variant…</option>
                      {line.match.options.map((o) => (
                        <option key={o.sku} value={o.sku}>
                          {o.label === o.sku ? o.sku : `${o.label} · ${o.sku}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null,
              )}

              {data.shippingError ? (
                <p className="text-sm text-red-200">{data.shippingError}</p>
              ) : (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-sm text-slate-300">Shipping method (cheapest first):</legend>
                  {data.shipping.map((o) => {
                    const value = `${o.from}|${o.method}`;
                    return (
                      <label key={value} className="flex items-center gap-2 text-sm text-slate-200">
                        <input type="radio" name="cj-method" value={value} checked={method === value} onChange={() => setMethod(value)} />
                        {`${o.method} · ${money(o.price)}${o.days ? ` · ${o.days} days` : ""} · from ${o.from === "US" ? "US warehouse" : "China"}`}
                      </label>
                    );
                  })}
                </fieldset>
              )}

              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
                Test order only (CJ sandbox: no charge, nothing shipped, eBay order untouched)
              </label>

              <button
                type="button"
                onClick={() => void place()}
                disabled={!ready || busy !== null}
                className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
              >
                {busy === "placing" ? "Creating on CJ…" : sandbox ? "Create test order on CJ" : "Create CJ order (you pay it in CJ)"}
              </button>
              <p className="text-xs text-slate-500">
                AutoPilot sends CJ the buyer&apos;s address, the variant and the shipping method. It never pays: the order waits
                in your CJ account (My CJ → Orders) until you pay it.
              </p>
            </>
          )}
        </>
      )}
      {message ? <p className={`text-sm ${message.tone === "ok" ? "text-lime-brand" : "text-red-200"}`}>{message.text}</p> : null}
    </div>
  );
}
