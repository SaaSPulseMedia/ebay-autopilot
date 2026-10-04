import Link from "next/link";

import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isBrowserEngineAvailable } from "@/lib/ebay/browser-list";
import { isEbayConfigured } from "@/lib/ebay/oauth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

const messages: Record<string, string> = {
  "not-configured":
    "Live eBay connections are not switched on for this site yet. You can keep working in demo mode, and nothing you do here will be posted to eBay.",
  denied: "You cancelled on eBay's screen, so nothing was connected. You can try again whenever you like.",
  connected: "Your eBay store is connected. Listings you publish will go live on your shop.",
  "demo-connected": "Connected in demo mode. Everything works, but nothing is posted to eBay.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ebay?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;

  const accounts = await db.select().from(ebayAccounts).where(eq(ebayAccounts.userId, user.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Store connections and publishing engines for {user.email}.</p>
      </div>

      {params.ebay && messages[params.ebay] ? (
        <p className="ap-card rounded-2xl p-4 text-sm text-slate-200">{messages[params.ebay]}</p>
      ) : null}

      <section className="ap-card space-y-4 rounded-2xl p-6">
        <h2 className="text-base font-semibold text-white">Your eBay store</h2>
        <p className="text-sm leading-relaxed text-slate-400">
          Press the button below and you will be taken to eBay. Sign in there as you normally would, approve the
          permission screen eBay shows you, and you will come straight back here connected.
        </p>
        <p className="rounded-xl border border-lime-brand/25 bg-lime-brand/[0.07] px-4 py-3 text-sm leading-relaxed text-lime-brand">
          You type your password into eBay&apos;s website, never ours — we never see it. You can withdraw the
          permission from your own eBay account settings at any time. There is nothing else to set up: no developer
          account, no keys, no configuration.
        </p>

        {accounts.length ? (
          <ul className="space-y-2">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-sm">
                <span className="text-white">{account.label}</span>
                <span className="rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] uppercase tracking-wide text-brand-400">
                  {account.mode}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-white/15 p-5 text-sm text-slate-400">
            No store connected yet. You are in demo mode, which means you can try everything safely — nothing reaches
            eBay until you connect.
          </p>
        )}

        <Link
          href="/api/ebay/connect"
          className="inline-block rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400"
        >
          Connect eBay store
        </Link>
      </section>

      <section className="ap-card space-y-3 rounded-2xl p-6 text-sm">
        <h2 className="text-base font-semibold text-white">How your listings are being published</h2>
        <p className="leading-relaxed text-slate-400">
          You do not need to choose anything here — AutoPilot picks the best available method on its own. This is just
          so you can see what is happening.
        </p>
        <p className="text-slate-300">
          Posting straight to eBay:{" "}
          <span className={isEbayConfigured() ? "text-lime-brand" : "text-slate-400"}>
            {isEbayConfigured() ? "available" : "not switched on yet"}
          </span>
        </p>
        <p className="text-slate-300">
          Backup posting method:{" "}
          <span className={isBrowserEngineAvailable() ? "text-lime-brand" : "text-slate-400"}>
            {isBrowserEngineAvailable() ? "available" : "still being built"}
          </span>
        </p>
        <p className="text-slate-300">
          Demo mode (nothing reaches eBay): <span className="text-lime-brand">always available</span>
        </p>
        <p className="pt-1 text-slate-500">
          Not sure what any of this means? You do not need to —{" "}
          <Link href="/guide" className="text-brand-400 hover:text-brand-500">
            read the plain-English guide
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
