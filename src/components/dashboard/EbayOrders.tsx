"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AutoOrderOnCj } from "@/components/dashboard/AutoOrderOnCj";
import { AutoOrdering } from "@/components/dashboard/AutoOrdering";
import type { EbayOrder, ShipTo } from "@/lib/ebay/orders";
import type { CjMatch } from "@/lib/order-fulfillment";

type Show = "awaiting" | "all";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; notConnected?: boolean }
  | { status: "done"; orders: EbayOrder[]; total: number; cj: Record<string, CjMatch | null>; fulfillment: Record<string, Fulfillment> };

/** The CJ order AutoPilot created for an eBay order. */
type Fulfillment = { status: string; trackingNumber: string | null; sandbox: boolean; error: string | null; note: string | null; auto: boolean };

const CJ_STATUS: Record<string, { label: string; tone: string }> = {
  created: { label: "CJ: to pay", tone: "bg-amber-300/15 text-amber-200" },
  paid: { label: "CJ: paid", tone: "bg-brand-500/20 text-brand-300" },
  shipped: { label: "CJ: shipped", tone: "bg-brand-500/20 text-brand-300" },
  tracking_sent: { label: "Tracking on eBay ✓", tone: "bg-lime-brand/15 text-lime-brand" },
  cancelled: { label: "CJ: cancelled", tone: "bg-white/10 text-slate-300" },
  error: { label: "CJ order failed", tone: "bg-red-400/15 text-red-200" },
  held: { label: "Needs you", tone: "bg-amber-300/15 text-amber-200" },
};

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "To ship",
  IN_PROGRESS: "In progress",
  FULFILLED: "Shipped",
};

/** Address as a shipping label reads, one line per field. */
export function addressText(shipTo: ShipTo) {
  const cityLine = [shipTo.city, [shipTo.stateOrProvince, shipTo.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [shipTo.fullName, shipTo.addressLine1, shipTo.addressLine2, cityLine, shipTo.countryCode, shipTo.phone]
    .filter(Boolean)
    .join("\n");
}

function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Clipboard API where allowed, a hidden textarea + execCommand otherwise. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        setState((await copyText(text)) ? "copied" : "failed");
        setTimeout(() => setState("idle"), 2000);
      }}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        state === "copied"
          ? "border-lime-brand/40 bg-lime-brand/10 text-lime-brand"
          : state === "failed"
            ? "border-red-500/40 text-red-300"
            : "border-white/20 text-slate-100 hover:bg-white/5"
      } ${className}`}
    >
      {state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed — select the text" : label}
    </button>
  );
}

function FulfillModal({
  order,
  cj,
  onClose,
  onChanged,
}: {
  order: EbayOrder;
  cj: Record<string, CjMatch | null>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const address = order.shipTo ? addressText(order.shipTo) : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fulfill-title"
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-navy-950 shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="fulfill-title" className="text-lg font-semibold text-white">
              Fulfill on CJ
            </h2>
            <p className="mt-0.5 text-sm text-slate-400">
              eBay order {order.orderId}
              {order.total ? ` · ${order.total}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-white/15 p-1.5 text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-white">Order automatically on CJ (beta)</h3>
            <AutoOrderOnCj orderId={order.orderId} onChanged={onChanged} />
          </section>

          <p className="border-t border-white/10 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Or order by hand</p>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white">Ship to</h3>
              {address ? <CopyButton text={address} label="Copy address" /> : null}
            </div>
            {address ? (
              <pre className="whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-sans text-sm leading-relaxed text-slate-100">
                {address}
              </pre>
            ) : (
              <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                eBay didn&apos;t include a shipping address for this order. Check it in Seller Hub before ordering.
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-white">Order on CJ</h3>
            <ul className="space-y-3">
              {order.lines.map((line) => {
                const match = line.sku ? cj[line.sku] : null;
                return (
                  <li key={line.lineItemId} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="text-sm font-medium text-white">
                      {line.quantity > 1 ? <span className="text-lime-brand">{line.quantity} × </span> : null}
                      {line.title}
                    </p>
                    {line.variation ? <p className="mt-0.5 text-xs text-slate-400">{line.variation}</p> : null}
                    <p className="mt-0.5 text-[11px] text-slate-500">eBay SKU: {line.sku || "none"}</p>

                    {match ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-slate-400">
                          CJ product: <span className="text-slate-200">{match.productTitle}</span>
                        </p>
                        {match.cjSku ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-lg bg-white/5 px-2.5 py-1.5 font-mono text-sm text-white">
                              {match.cjSku}
                            </span>
                            {match.cjVariant && match.cjVariant !== match.cjSku ? (
                              <span className="text-xs text-slate-400">{match.cjVariant}</span>
                            ) : null}
                            <CopyButton text={match.cjSku} label="Copy CJ SKU" />
                          </div>
                        ) : match.options.length ? (
                          <div className="text-xs text-slate-400">
                            <p className="mb-1">
                              Pick the variant the buyer chose{line.variation ? ` (${line.variation})` : ""}:
                            </p>
                            <ul className="flex flex-wrap gap-1.5">
                              {match.options.map((option) => (
                                <li key={option.sku}>
                                  <span
                                    className="inline-block rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] text-slate-200"
                                    title={option.sku}
                                  >
                                    {option.label}
                                    {option.label !== option.sku ? ` · ${option.sku}` : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <a
                          href={match.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-400"
                        >
                          Open product on CJ
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-3.5 w-3.5" aria-hidden="true">
                            <path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </a>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
                        AutoPilot couldn&apos;t match this item to a CJ product. It may have been listed outside AutoPilot,
                        or from a product that isn&apos;t in your CJ catalog. Search CJ for it by name.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="text-xs text-slate-500">
            By hand: place the order on CJ with this address, then add the tracking number to the order in eBay Seller
            Hub. Orders created automatically above get their tracking added to eBay by AutoPilot.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Live eBay orders, each with "Fulfill on CJ": an automatic CJ order, or the manual steps. */
export function EbayOrders() {
  const [show, setShow] = useState<Show>("awaiting");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [open, setOpen] = useState<EbayOrder | null>(null);

  /** `quiet`: refresh in place (the open Fulfill window stays open), no loading state. */
  const load = useCallback(async (which: Show, quiet = false) => {
    if (!quiet) setState({ status: "loading" });
    try {
      const res = await fetch(`/api/orders?show=${which}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        if (quiet) return;
        setState({
          status: "error",
          message: body?.error ?? `Couldn't load orders (HTTP ${res.status}).`,
          notConnected: Boolean(body?.notConnected),
        });
        return;
      }
      setState({ status: "done", orders: body.orders, total: body.total, cj: body.cj ?? {}, fulfillment: body.fulfillment ?? {} });
    } catch {
      if (!quiet) setState({ status: "error", message: "Couldn't reach AutoPilot. Check your connection and try again." });
    }
  }, []);

  useEffect(() => {
    void load(show); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load, show]);

  const closeModal = useCallback(() => setOpen(null), []);

  return (
    <section className="space-y-3">
      <AutoOrdering onRun={() => void load(show, true)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-white/15 p-0.5 text-xs font-semibold" role="tablist">
          {(["awaiting", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={show === value}
              onClick={() => setShow(value)}
              className={`rounded-full px-3.5 py-1.5 ${show === value ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {value === "awaiting" ? "To ship" : "All (90 days)"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load(show)}
          disabled={state.status === "loading"}
          className="rounded-full border border-white/20 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
        >
          {state.status === "loading" ? "Loading…" : "Refresh"}
        </button>
      </div>

      {state.status === "loading" ? (
        <div className="ap-card space-y-2 rounded-2xl p-4" aria-busy="true" aria-label="Loading orders">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <div className="ap-card rounded-2xl p-6 text-sm text-slate-300">
          <p>{state.message}</p>
          {state.notConnected ? (
            <Link href="/dashboard/settings" className="mt-2 inline-block font-semibold text-brand-400 hover:text-brand-500">
              Connect your eBay store →
            </Link>
          ) : (
            <button type="button" onClick={() => void load(show)} className="mt-2 font-semibold text-brand-400 hover:text-brand-500">
              Try again
            </button>
          )}
        </div>
      ) : state.orders.length === 0 ? (
        <p className="ap-card rounded-2xl p-10 text-center text-sm text-slate-400">
          {show === "awaiting" ? "No eBay orders waiting to ship." : "No eBay orders in the last 90 days."}
        </p>
      ) : (
        <div className="ap-card overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Ship to</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {state.orders.map((order) => {
                const first = order.lines[0];
                const more = order.lines.length - 1;
                const to = order.shipTo;
                return (
                  <tr key={order.orderId} className="border-b border-white/5 align-top last:border-0">
                    <td className="px-4 py-3">
                      <span className="block font-medium text-white">{to?.fullName || order.buyerUsername || "eBay buyer"}</span>
                      <span className="block text-[11px] text-slate-500">
                        {order.buyerUsername ? `${order.buyerUsername} · ` : ""}
                        {formatDate(order.createdAt)}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <span className="block truncate text-slate-200" title={first?.title}>
                        {first ? `${first.quantity > 1 ? `${first.quantity} × ` : ""}${first.title}` : "—"}
                      </span>
                      {first?.variation ? <span className="block text-[11px] text-slate-500">{first.variation}</span> : null}
                      {more > 0 ? <span className="block text-[11px] text-slate-500">+ {more} more item{more === 1 ? "" : "s"}</span> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{first?.sku || "—"}</td>
                    <td className="px-4 py-3 text-xs leading-relaxed text-slate-300">
                      {to ? (
                        <>
                          {to.addressLine1}
                          {to.addressLine2 ? <>, {to.addressLine2}</> : null}
                          <br />
                          {[to.city, [to.stateOrProvince, to.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")}{" "}
                          {to.countryCode}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          order.fulfillmentStatus === "FULFILLED"
                            ? "bg-white/10 text-slate-300"
                            : "bg-lime-brand/15 text-lime-brand"
                        }`}
                      >
                        {STATUS_LABEL[order.fulfillmentStatus] ?? order.fulfillmentStatus}
                      </span>
                      {(() => {
                        const f = state.fulfillment[order.orderId];
                        const look = f ? CJ_STATUS[f.status] : null;
                        if (!f || !look || f.sandbox) return null;
                        // Automatic ordering says what it did, or why it left the order for the seller.
                        const say = f.auto ? (f.error ?? f.note) : null;
                        return (
                          <>
                            <span className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${look.tone}`} title={f.error ?? f.note ?? undefined}>
                              {f.auto ? `Auto · ${look.label}` : look.label}
                            </span>
                            {say ? <span className={`mt-1 block max-w-xs text-[11px] ${f.error ? "text-amber-200" : "text-slate-400"}`}>{say}</span> : null}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setOpen(order)}
                        className="whitespace-nowrap rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-400"
                      >
                        Fulfill on CJ
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {state.status === "done" && state.total > state.orders.length ? (
        <p className="text-xs text-slate-500">
          Showing the newest {state.orders.length} of {state.total} orders.
        </p>
      ) : null}

      {open && state.status === "done" ? (
        <FulfillModal order={open} cj={state.cj} onClose={closeModal} onChanged={() => void load(show, true)} />
      ) : null}
    </section>
  );
}
