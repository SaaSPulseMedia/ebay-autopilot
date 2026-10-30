"use client";

import { useState } from "react";

/** eBay's carrier for a tracking number, guessed from its shape (the seller can change it). */
function guessCarrier(tracking: string) {
  const t = tracking.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return "UPS";
  if (/^9[2-5]\d{18,24}$/.test(t)) return "USPS";
  if (/^\d{12}$|^\d{15}$/.test(t)) return "FedEx";
  return "Other";
}

const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"];

/**
 * For an order AutoPilot isn't fulfilling through CJ (e.g. AliExpress):
 * "Mark shipped" (tracking number onto the eBay order, optionally with the
 * thank-you message) and "Send message" (the thank-you message alone).
 */
export function OrderActions({ orderId, messaged, onDone }: { orderId: string; messaged: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("Other");
  const [carrierTouched, setCarrierTouched] = useState(false);
  const [withMessage, setWithMessage] = useState(!messaged);
  const [busy, setBusy] = useState<"ship" | "message" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState(messaged);

  async function ship() {
    setBusy("ship");
    setNote(null);
    try {
      const res = await fetch("/api/orders/ship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, trackingNumber: tracking, carrier, sendMessage: withMessage && !sent }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; messageSent?: boolean; messageError?: string | null } | null;
      if (!json?.ok) {
        setNote({ ok: false, text: json?.error ?? `Didn't go through (HTTP ${res.status}).` });
        return;
      }
      if (json.messageSent) setSent(true);
      setNote({
        ok: true,
        text: `Marked shipped on eBay with tracking ${tracking}.${json.messageSent ? " Message sent." : json.messageError ? ` Message not sent: ${json.messageError}` : ""}`,
      });
      setTimeout(onDone, 2500);
    } catch {
      setNote({ ok: false, text: "The connection dropped. Refresh to see if it went through." });
    } finally {
      setBusy(null);
    }
  }

  async function message() {
    setBusy("message");
    setNote(null);
    try {
      const res = await fetch("/api/orders/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (json?.ok) setSent(true);
      setNote(json?.ok ? { ok: true, text: "Message sent to the buyer." } : { ok: false, text: json?.error ?? `Not sent (HTTP ${res.status}).` });
    } catch {
      setNote({ ok: false, text: "The connection dropped. Try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 flex flex-col items-end gap-1.5 text-left">
      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="whitespace-nowrap rounded-full border border-white/15 px-3 py-1 text-[11px] text-slate-200 hover:bg-white/5"
        >
          Mark shipped
        </button>
        {sent ? (
          <span className="whitespace-nowrap rounded-full bg-lime-brand/10 px-3 py-1 text-[11px] text-lime-brand">Message sent ✓</span>
        ) : (
          <button
            type="button"
            onClick={() => void message()}
            disabled={busy !== null}
            className="whitespace-nowrap rounded-full border border-white/15 px-3 py-1 text-[11px] text-slate-200 hover:bg-white/5 disabled:opacity-50"
          >
            {busy === "message" ? "Sending…" : "Send message"}
          </button>
        )}
      </div>
      {open ? (
        <div className="w-64 space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-300">
          <label className="block">
            Tracking number (from AliExpress)
            <input
              value={tracking}
              onChange={(e) => {
                setTracking(e.target.value);
                if (!carrierTouched) setCarrier(guessCarrier(e.target.value));
              }}
              className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 font-mono text-xs text-white"
            />
          </label>
          <label className="block">
            Carrier
            <select
              value={carrier}
              onChange={(e) => {
                setCarrier(e.target.value);
                setCarrierTouched(true);
              }}
              className="mt-1 w-full rounded-lg border border-white/15 bg-navy-950 px-2 py-1.5 text-xs text-white"
            >
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c === "Other" ? "Other (Cainiao, YunExpress, 4PX…)" : c}
                </option>
              ))}
            </select>
          </label>
          {!sent ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={withMessage} onChange={(e) => setWithMessage(e.target.checked)} className="accent-brand-500" />
              Also send my thank-you message
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => void ship()}
            disabled={busy !== null || tracking.trim().length < 6}
            className="w-full rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
          >
            {busy === "ship" ? "Sending to eBay…" : "Mark shipped on eBay"}
          </button>
        </div>
      ) : null}
      {note ? <p className={`max-w-xs text-[11px] ${note.ok ? "text-lime-brand" : "text-red-300"}`}>{note.text}</p> : null}
    </div>
  );
}
