"use client";

import Link from "next/link";

export type BatchItem = { title: string; status: string; variants: number; message: string };

export type BatchResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  upgrade?: boolean;
  upgradePlan?: string | null;
  requested?: number;
  published?: number;
  scheduled?: number;
  blocked?: number;
  skipped?: number;
  variantTotal?: number;
  results?: BatchItem[];
};

/** "Release gradually" switch. Starter sees it locked with a link to Billing. */
export function DripToggle({
  allowed,
  checked,
  perRun,
  onChange,
}: {
  allowed: boolean;
  checked: boolean;
  perRun: number;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-xs ${
        allowed ? "cursor-pointer border-white/12 text-slate-300" : "border-white/8 text-slate-500"
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5"
        disabled={!allowed}
        checked={allowed && checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-semibold text-white">Drip posting</span> — release this batch gradually, up to {perRun}{" "}
        listings per hour, instead of all at once.
        {!allowed ? (
          <>
            {" "}
            Included in{" "}
            <Link href="/dashboard/billing" className="font-semibold text-lime-brand underline">
              Pro and Business
            </Link>
            .
          </>
        ) : null}
      </span>
    </label>
  );
}

/** Result box after a batch: what went out, what is scheduled, what was skipped and why. */
export function BatchSummary({ summary, perRun }: { summary: BatchResponse; perRun: number }) {
  if (!summary.ok) {
    return (
      <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-amber-100">
              ⚠️ {summary.code === "plan_limit_reached" ? "Plan limit reached" : "The batch could not be listed"}
            </p>
            <p className="mt-1 text-slate-300">{summary.error}</p>
          </div>
          {summary.upgrade ? (
            <Link
              href="/dashboard/billing"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-brand-500 px-5 py-2 text-xs font-bold text-white transition hover:bg-brand-400"
            >
              Upgrade to {summary.upgradePlan ?? "Pro"} →
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const notListed = (summary.results ?? []).filter((row) => row.status === "blocked" || row.status === "skipped");
  const withNotes = (summary.results ?? []).filter((row) => row.message.includes("Note:"));

  return (
    <div className="rounded-2xl border border-lime-brand/30 bg-lime-brand/10 px-4 py-3 text-sm text-lime-brand">
      <p>
        Batch complete: {summary.published ?? 0} published
        {summary.scheduled ? `, ${summary.scheduled} scheduled for drip posting (up to ${perRun} go out each hour)` : ""}
        {notListed.length ? `, ${notListed.length} not listed` : ""} — {summary.variantTotal ?? 0} variant rows built.
        Open the Listings tab to review them.
      </p>
      {notListed.length ? (
        <ul className="mt-2 space-y-1 text-amber-200">
          {notListed.map((row, index) => (
            <li key={`${row.title}-${index}`}>
              ⛔ <span className="font-medium">{row.title}</span>: {row.message}
            </li>
          ))}
        </ul>
      ) : null}
      {withNotes.length ? (
        <ul className="mt-2 space-y-1 text-slate-300">
          {withNotes.map((row, index) => (
            <li key={`${row.title}-note-${index}`}>
              ℹ️ <span className="font-medium">{row.title}</span>: {row.message.split("Note:")[1]?.trim()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
