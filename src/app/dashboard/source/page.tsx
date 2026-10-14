import "server-only";

import Link from "next/link";

import { SourceSearch } from "@/components/dashboard/SourceSearch";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Source products" };

export default async function SourcePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const configured = Boolean(process.env.CJ_API_KEY?.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Source products</h1>
        <p className="mt-1 text-sm text-slate-400">
          Search CJ Dropshipping&apos;s catalog and add products to your catalog. Added products show up in{" "}
          <Link href="/dashboard/bulk" className="font-semibold text-brand-400 hover:text-brand-500">
            Bulk list
          </Link>{" "}
          with live CJ prices, ready to publish.
        </p>
      </div>
      {configured ? (
        <SourceSearch />
      ) : (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-200">
          CJ sourcing isn&apos;t set up yet: the CJ_API_KEY environment variable is missing.
        </p>
      )}
    </div>
  );
}
