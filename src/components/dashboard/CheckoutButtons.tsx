"use client";

import { useState } from "react";

import { PLANS } from "@/lib/plans";

export function CheckoutButtons({ currentPlan }: { currentPlan: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function start(planId: string) {
    setBusy(planId);
    setMessage(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const json = (await res.json()) as { ok: boolean; url?: string; demo?: boolean; message?: string };
      if (json.url && !json.demo) {
        window.location.href = json.url;
        return;
      }
      setMessage(json.message ?? "Checkout unavailable.");
    } catch {
      setMessage("Could not start checkout.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
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
              disabled={busy === plan.id}
              onClick={() => start(plan.id)}
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
      {message ? (
        <p className="rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-slate-300">{message}</p>
      ) : null}
    </div>
  );
}
