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

type Panel = "ship" | "message" | null;

/**
 * For one eBay order: "Mark shipped" (tracking number onto the eBay order,
 * for orders AutoPilot doesn't follow on CJ) and "Send message" (the
 * thank-you message). The message is always shown first, with this buyer's
 * name and item filled in, and can be edited: nothing is sent unchecked.
 */
export function OrderActions({
  orderId,
  messaged,
  messageError = null,
  onDone,
  canShip = true,
}: {
  orderId: string;
  messaged: boolean;
  /** eBay's reason when an earlier attempt (e.g. the automatic one) failed. */
  messageError?: string | null;
  onDone: () => void;
  /** False for an order AutoPilot follows on CJ: its tracking goes on eBay by itself, only "Send message" is offered. */
  canShip?: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("Other");
  const [carrierTouched, setCarrierTouched] = useState(false);
  const [withMessage, setWithMessage] = useState(!messaged);
  const [draft, setDraft] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [busy, setBusy] = useState<"ship" | "message" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState(messaged);

  /** The message as this buyer would get it, fetched once, for checking and editing. */
  async function loadDraft() {
    if (draft !== null || loadingDraft) return;
    setLoadingDraft(true);
    try {
      const res = await fetch(`/api/orders/message?orderId=${encodeURIComponent(orderId)}`);
      const json = (await res.json().catch(() => null)) as { ok: boolean; body?: string; error?: string } | null;
      if (json?.ok && typeof json.body === "string") setDraft(json.body);
      else setNote({ ok: false, text: json?.error ?? "Couldn't prepare the message. Try again." });
    } catch {
      setNote({ ok: false, text: "Couldn't prepare the message. Try again." });
    } finally {
      setLoadingDraft(false);
    }
  }

  function open(next: Panel) {
    setNote(null);
    setPanel((current) => (current === next ? null : next));
    if (next === "message" || (next === "ship" && withMessage && !sent)) void loadDraft();
  }

  async function ship() {
    setBusy("ship");
    setNote(null);
    const sendMessage = withMessage && !sent && Boolean(draft?.trim());
    try {
      const res = await fetch("/api/orders/ship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, trackingNumber: tracking, carrier, sendMessage, messageBody: sendMessage ? draft : undefined }),
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
      setPanel(null);
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
        body: JSON.stringify({ orderId, body: draft }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (json?.ok) {
        setSent(true);
        setPanel(null);
      }
      setNote(json?.ok ? { ok: true, text: "Message sent to the buyer." } : { ok: false, text: json?.error ?? `Not sent (HTTP ${res.status}).` });
    } catch {
      setNote({ ok: false, text: "The connection dropped. Try again." });
    } finally {
      setBusy(null);
    }
  }

  const messageBox = (
    <label className="block">
      The message, as the buyer will get it (you can change it):
      {loadingDraft || draft === null ? (
        <p className="mt-1 text-slate-500">{loadingDraft ? "Preparing…" : ""}</p>
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          maxLength={2000}
          className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-white"
        />
      )}
    </label>
  );

  return (
    <div className="mt-2 flex flex-col items-end gap-1.5 text-left">
      <div className="flex flex-wrap justify-end gap-1.5">
        {canShip ? (
          <button
            type="button"
            onClick={() => open("ship")}
            className="whitespace-nowrap rounded-full border border-white/15 px-3 py-1 text-[11px] text-slate-200 hover:bg-white/5"
          >
            Mark shipped
          </button>
        ) : null}
        {sent ? (
          <span className="whitespace-nowrap rounded-full bg-lime-brand/10 px-3 py-1 text-[11px] text-lime-brand">Message sent ✓</span>
        ) : (
          <button
            type="button"
            onClick={() => open("message")}
            className="whitespace-nowrap rounded-full border border-white/15 px-3 py-1 text-[11px] text-slate-200 hover:bg-white/5"
          >
            Send message…
          </button>
        )}
      </div>

      {panel === "message" && !sent ? (
        <div className="w-72 space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-300">
          {messageBox}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void message()}
              disabled={busy !== null || !draft?.trim()}
              className="flex-1 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
            >
              {busy === "message" ? "Sending…" : "Send"}
            </button>
            <button type="button" onClick={() => setPanel(null)} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {panel === "ship" && canShip ? (
        <div className="w-72 space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-300">
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
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={withMessage}
                  onChange={(e) => {
                    setWithMessage(e.target.checked);
                    if (e.target.checked) void loadDraft();
                  }}
                  className="accent-brand-500"
                />
                Also send my thank-you message
              </label>
              {withMessage ? messageBox : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void ship()}
            disabled={busy !== null || tracking.trim().length < 6 || (withMessage && !sent && !draft?.trim())}
            className="w-full rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
          >
            {busy === "ship" ? "Sending to eBay…" : withMessage && !sent ? "Mark shipped and send message" : "Mark shipped on eBay"}
          </button>
        </div>
      ) : null}
      {!sent && messageError && !note ? <p className="max-w-xs text-[11px] text-amber-200">{`Message not sent: ${messageError}`}</p> : null}
      {note ? <p className={`max-w-xs text-[11px] ${note.ok ? "text-lime-brand" : "text-red-300"}`}>{note.text}</p> : null}
    </div>
  );
}
