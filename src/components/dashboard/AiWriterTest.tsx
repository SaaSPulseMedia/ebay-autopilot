"use client";

import { useState } from "react";

/** "Test AI writer": one sample listing, then Claude's title or the reason the backup was used. */
export function AiWriterTest() {
  const [state, setState] = useState<
    { status: "idle" } | { status: "running" } | { status: "done"; ok: boolean; title: string; failure: string | null; seconds: number }
  >({ status: "idle" });

  async function run() {
    setState({ status: "running" });
    try {
      const res = await fetch("/api/ai-writer-test", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; title?: string; failure?: string | null; seconds?: number; error?: string };
      setState({ status: "done", ok: json.ok, title: json.title ?? "", failure: json.failure ?? json.error ?? null, seconds: json.seconds ?? 0 });
    } catch {
      setState({ status: "done", ok: false, title: "", failure: "The test didn't finish (connection dropped). Try again.", seconds: 0 });
    }
  }

  return (
    <span className="mt-2 block space-y-1.5">
      <button
        type="button"
        onClick={run}
        disabled={state.status === "running"}
        className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
      >
        {state.status === "running" ? "Testing… (up to 45 s)" : "Test AI writer"}
      </button>
      {state.status === "done" ? (
        state.ok ? (
          <span className="block text-xs text-lime-brand">{`Working (${state.seconds} s). Sample title: "${state.title}"`}</span>
        ) : (
          <span className="block text-xs text-amber-200">
            {`Not working: listings get the backup title. Reason: ${state.failure ?? "unknown"}`}
          </span>
        )
      ) : null}
    </span>
  );
}
