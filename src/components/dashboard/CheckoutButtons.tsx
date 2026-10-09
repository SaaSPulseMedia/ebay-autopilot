"use client";

import { useState } from "react";

import { PLANS } from "@/lib/plans";

type Notice = { tone: "info" | "error"; text: string };

async function postForUrl(path: string, body?: unknown): Promise<{ url?: string; error?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (res.ok && json.url) return { url: json.url };
  return { error: json.error ?? "Something went wrong. Please try again." };
}

export function CheckoutButtons({ currentPlan, hasSubscription }: { currentPlan: string; hasSubscription: boolean }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function go(key: string, path: string, body?: unknown) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await postForUrl(path, body);
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      setNotice({ tone: "error", text: result.error ?? "Something went wrong." });
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    }
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      {hasSubscription ? (
        <div className="ap-card flex flex-col gap-3 rounded-2xl p-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-300">Change plan, cancel, or update your card in the Stripe customer portal.</p>
          <button
            type="button"
            disabled={busy === "portal"}
            onClick={() => go("portal", "/api/stripe/portal")}
            className="shrink-0 rounded-full border border-lime-brand/40 px-5 py-2.5 font-semibold text-lime-brand transition hover:bg-lime-brand/10 disabled:opacity-60"
          >
            {busy === "portal" ? "Opening…" : "Manage subscription"}
          </button>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div key={plan.id} className="ap-card rounded-2xl p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold text-white">{plan.name}</h3>
              <span className="text-xl font-bold text-white">${plan.price}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{plan.tagline}</p>
            <button
              type="button"
              disabled={busy !== null || currentPlan === plan.id}
              onClick={() => go(plan.id, "/api/stripe/checkout", { planId: plan.id })}
              className={`mt-4 w-full rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                currentPlan === plan.id
                  ? "border border-lime-brand/40 text-lime-brand"
                  : "bg-brand-500 text-white hover:bg-brand-400"
              } disabled:opacity-60`}
            >
              {currentPlan === plan.id ? "Current plan" : busy === plan.id ? "Starting…" : `Choose ${plan.name}`}
            </button>
          </div>
        ))}
      </div>
      {notice ? (
        <p
          role="alert"
          className={`rounded-xl border px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
              : "border-lime-brand/30 bg-lime-brand/10 text-lime-brand"
          }`}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
