import { ImportLister } from "@/components/dashboard/ImportLister";
import { getCurrentUser } from "@/lib/auth";
import { DRIP_PER_RUN, planLimits } from "@/lib/limits";
import { activeListingCount } from "@/lib/listing-pipeline";
import { MIN_PROFIT_LABEL } from "@/lib/pricing";
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
        <h1 className="text-2xl font-bold tracking-tight text-white">Paste CJ links</h1>
        <p className="mt-1 text-sm text-slate-400">
          Paste CJ Dropshipping product links, set your markup, press one button. AutoPilot imports each product from
          CJ, gets CJ&apos;s real shipping cost to the US, writes the listing, builds the variants, checks for brand
          names, and publishes them all.
        </p>
        <p className="mt-3 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs leading-relaxed text-slate-300">
          Prices are your markup on the <span className="text-white">true landed cost</span>: CJ cost + CJ&apos;s real
          shipping + eBay&apos;s $0.40 order fee, never less than <span className="text-white">{`${MIN_PROFIT_LABEL} profit`}</span> per
          sale. Links from other suppliers are skipped, because only CJ provides the real shipping cost. About 8 links
          go through per run.
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
