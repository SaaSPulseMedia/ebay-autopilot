import "server-only";

import Link from "next/link";

import { WinningProducts } from "@/components/dashboard/WinningProducts";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Winning products" };

export default async function WinningPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const configured = Boolean(process.env.CJ_API_KEY?.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Winning products</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          CJ products ranked by <span className="text-white">Winning Score</span>{" "}
          (0–100): 40% profit per sale at the suggested eBay
          price after fees, 30% low competition, 20% ships from CJ&apos;s US warehouse, 10% recently added. Scores use CJ
          data only; eBay sold-item data isn&apos;t available to AutoPilot yet. Want to search by keyword instead?{" "}
          <Link href="/dashboard/source" className="font-semibold text-brand-400 hover:text-brand-500">
            Source →
          </Link>
        </p>
      </div>
      {configured ? (
        <WinningProducts />
      ) : (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-200">
          CJ sourcing isn&apos;t set up yet: the CJ_API_KEY environment variable is missing.
        </p>
      )}
    </div>
  );
}
