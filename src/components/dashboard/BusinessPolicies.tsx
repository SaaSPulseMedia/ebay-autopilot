"use client";

import { useCallback, useEffect, useState } from "react";

type Option = { id: string; name: string };
type Kind = "fulfillmentPolicyId" | "paymentPolicyId" | "returnPolicyId";
type Selection = Record<Kind, string>;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; fulfillment: Option[]; payment: Option[]; returns: Option[]; saved: boolean };

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

const SELECT =
  "w-full rounded-lg border border-white/15 bg-navy-900 px-2.5 py-2 text-sm text-white outline-none focus:border-brand-500 disabled:opacity-60";

/** Lets a connected seller choose which eBay business policies AutoPilot puts on new listings. */
export function BusinessPolicies() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [selection, setSelection] = useState<Selection>({ fulfillmentPolicyId: "", paymentPolicyId: "", returnPolicyId: "" });
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const fetchPolicies = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const res = await fetch("/api/ebay/policies");
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setLoad({ status: "error", message: body?.error ?? `Couldn't load your eBay policies (HTTP ${res.status}).` });
        return;
      }
      const { fulfillment, payment, returns, selected } = body as {
        fulfillment: Option[];
        payment: Option[];
        returns: Option[];
        selected: Record<Kind, string | null>;
      };
      // Saved choice when it still exists, else the first policy — the same rule publishing uses.
      const pick = (list: Option[], id: string | null) => (id && list.some((o) => o.id === id) ? id : (list[0]?.id ?? ""));
      setSelection({
        fulfillmentPolicyId: pick(fulfillment, selected.fulfillmentPolicyId),
        paymentPolicyId: pick(payment, selected.paymentPolicyId),
        returnPolicyId: pick(returns, selected.returnPolicyId),
      });
      const saved = Boolean(selected.fulfillmentPolicyId || selected.paymentPolicyId || selected.returnPolicyId);
      setLoad({ status: "done", fulfillment, payment, returns, saved });
    } catch {
      setLoad({ status: "error", message: "Couldn't reach AutoPilot. Check your connection and try again." });
    }
  }, []);

  useEffect(() => {
    void fetchPolicies(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [fetchPolicies]);

  async function change(kind: Kind, id: string) {
    const next = { ...selection, [kind]: id };
    setSelection(next);
    setSave({ status: "saving" });
    try {
      const res = await fetch("/api/ebay/policies/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillmentPolicyId: next.fulfillmentPolicyId || null,
          paymentPolicyId: next.paymentPolicyId || null,
          returnPolicyId: next.returnPolicyId || null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setSave({ status: "error", message: body?.error ?? `Couldn't save (HTTP ${res.status}).` });
        return;
      }
      setSave({ status: "saved" });
      setLoad((prev) => (prev.status === "done" ? { ...prev, saved: true } : prev));
    } catch {
      setSave({ status: "error", message: "Couldn't reach AutoPilot. Try again." });
    }
  }

  const fields: Array<{ kind: Kind; label: string; listKey: "fulfillment" | "payment" | "returns"; empty: string }> = [
    { kind: "fulfillmentPolicyId", label: "Shipping", listKey: "fulfillment", empty: "No shipping policies" },
    { kind: "paymentPolicyId", label: "Payment", listKey: "payment", empty: "No payment policies" },
    { kind: "returnPolicyId", label: "Returns", listKey: "returns", empty: "No return policies" },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Business Policies</h3>
        <span className="text-xs" aria-live="polite">
          {save.status === "saving" ? <span className="text-slate-400">Saving…</span> : null}
          {save.status === "saved" ? <span className="text-lime-brand">Saved ✓</span> : null}
          {save.status === "error" ? <span className="text-red-300">{save.message}</span> : null}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        The eBay shipping, payment and return policies AutoPilot puts on every new listing. Pick a shipping policy
        that ships from the US — a policy that ships from another country can make eBay reject the listing.
      </p>

      {load.status === "loading" ? (
        <div className="grid animate-pulse gap-3 sm:grid-cols-3" aria-busy="true" aria-label="Loading policies">
          {fields.map((f) => (
            <div key={f.kind} className="h-[62px] rounded-lg bg-white/5" />
          ))}
        </div>
      ) : null}

      {load.status === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <span>{load.message}</span>
          <button
            type="button"
            onClick={() => void fetchPolicies()}
            className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-white/5"
          >
            Try again
          </button>
        </div>
      ) : null}

      {load.status === "done" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {fields.map(({ kind, label, listKey, empty }) => {
              const list = load[listKey];
              return (
                <div key={kind}>
                  <label htmlFor={`policy-${kind}`} className="mb-1 block text-xs font-medium text-slate-400">
                    {label}
                  </label>
                  <select
                    id={`policy-${kind}`}
                    value={selection[kind]}
                    onChange={(e) => void change(kind, e.target.value)}
                    disabled={!list.length || save.status === "saving"}
                    className={SELECT}
                  >
                    {list.length ? null : <option value="">{empty}</option>}
                    {list.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {!load.saved ? (
            <p className="text-xs text-slate-500">
              Not chosen yet: AutoPilot uses the first policy of each kind (shown above). Change any dropdown to save
              your choice.
            </p>
          ) : null}
          {!load.fulfillment.length || !load.payment.length || !load.returns.length ? (
            <p className="text-xs text-amber-200">
              Create the missing policy in eBay Seller Hub (Account → Business policies), then reload this page.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
