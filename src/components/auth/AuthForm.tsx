"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, storeName: storeName || undefined }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "Something went wrong.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="ap-card w-full max-w-md rounded-2xl p-7">
      <h1 className="text-2xl font-bold tracking-tight text-white">
        {mode === "signup" ? "Start your 3-day free trial" : "Log in to AutoPilot"}
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        {mode === "signup"
          ? "No card required. You land straight in demo mode with the catalog loaded."
          : "Welcome back. Pick up where your listings left off."}
      </p>

      <div className="mt-6 space-y-4">
        {mode === "signup" ? (
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Store name (optional)</span>
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
              placeholder="Peak Gear Supply"
            />
          </label>
        ) : null}

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
            placeholder="you@store.com"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-white/15 bg-navy-900 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-500"
            placeholder="At least 8 characters"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
      >
        {busy ? "Working…" : mode === "signup" ? "Create account" : "Log in"}
      </button>

      <p className="mt-4 text-center text-sm text-slate-400">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-brand-400 hover:text-brand-500">
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="text-brand-400 hover:text-brand-500">
              Start a free trial
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
