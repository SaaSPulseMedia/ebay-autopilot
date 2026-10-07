import { ImportLister } from "@/components/dashboard/ImportLister";
import { getCurrentUser } from "@/lib/auth";
import { DRIP_PER_RUN, planLimits } from "@/lib/limits";
import { activeListingCount } from "@/lib/listing-pipeline";
import { getListingDefaults } from "@/lib/seller-settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Paste links" };

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const limits = planLimits(user.plan);
  const [activeUsed, defaults] = await Promise.all([activeListingCount(user.id), getListingDefaults(user.id)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Paste supplier links</h1>
        <p className="mt-1 text-sm text-slate-400">
          Paste your product links, set your markup, press one button. AutoPilot reads each page, writes the listing,
          builds the variants, checks for brand names, and publishes them all.
        </p>
        <p className="mt-3 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs leading-relaxed text-slate-300">
          Use <span className="text-white">wholesale or dropship suppliers</span>. Links to retail stores like Amazon,
          Walmart or Target are skipped, because eBay does not allow filling an order by buying it from another
          retailer — sellers get restricted for it. Works with supplier pages that show the product name and price
          without signing in.
        </p>
      </div>

      <ImportLister
        batchSize={limits.batchSize}
        remaining={Math.max(0, limits.activeListings - activeUsed)}
        dripAllowed={limits.dripPosting}
        dripPerRun={DRIP_PER_RUN}
        defaultMarkupPct={defaults.markupPct}
        defaultAdRatePct={defaults.adRatePct}
      />
    </div>
  );
}
