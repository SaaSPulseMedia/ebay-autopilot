"use client";

import { useEffect, useState } from "react";

import { renderMessage } from "@/lib/message-template";

type Settings = { enabled: boolean; template: string; enabledAt: string | null };

/** The thank-you message sent to every new buyer through eBay messaging, with a live preview. */
export function BuyerMessage() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/buyer-messages")
      .then((res) => res.json())
      .then((json: { ok: boolean; settings?: Settings }) => {
        if (!live || !json.settings) return;
        setSaved(json.settings);
        setEnabled(json.settings.enabled);
        setTemplate(json.settings.template);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/buyer-messages", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, template }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; settings?: Settings; error?: string } | null;
      if (!json?.ok || !json.settings) {
        setMessage(json?.error ?? `Couldn't save (HTTP ${res.status}).`);
        return;
      }
      setSaved(json.settings);
      setTemplate(json.settings.template);
      setMessage(json.settings.enabled ? "Saved. Every new sale from now on gets this message within the hour." : "Saved: the message is off.");
    } catch (error) {
      setMessage(`Couldn't save (${error instanceof Error ? error.message : "no answer"}).`);
    } finally {
      setBusy(false);
    }
  }

  if (!saved) return null;
  const dirty = enabled !== saved.enabled || template !== saved.template;
  const preview = renderMessage(template, { firstName: "Vanessa", itemTitle: "Men's Hooded Down Jacket", orderId: "11-15361-73824" });

  return (
    <section className="ap-card space-y-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Thank-you message to buyers</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Sent once to the buyer of every new sale, through eBay messages, within the hour of the sale.{" "}
            {saved.enabled && saved.enabledAt
              ? `On since ${new Date(saved.enabledAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}: only sales after that get it.`
              : "Off."}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-brand-500" />
          Send it automatically
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs text-slate-300">
          Your message. <span className="text-slate-500">{"{first_name}"} = the buyer&apos;s first name, {"{item}"} = what they bought (e.g. jacket), {"{order}"} = the order number.</span>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={6}
            maxLength={1500}
            className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
          />
        </label>
        <div className="text-xs text-slate-300">
          What Vanessa would have received:
          <p className="mt-1 whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200">{preview}</p>
          <p className="mt-1 text-slate-500">eBay blocks messages with links, email addresses or phone numbers, so keep it to plain words.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !dirty || !template.trim()}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {message ? <span className="text-xs text-slate-300">{message}</span> : null}
      </div>
    </section>
  );
}
