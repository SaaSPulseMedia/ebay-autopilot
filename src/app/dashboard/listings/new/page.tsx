import { ListingWizard } from "@/components/dashboard/ListingWizard";
import { getCurrentUser } from "@/lib/auth";
import { listPriceFor } from "@/lib/pricing";
import { getListingDefaults } from "@/lib/seller-settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "New listing" };

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; cost?: string; price?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;
  const defaults = await getListingDefaults(user.id);
  const cost = Number(params.cost ?? 0);
  const suggested = Number(params.price ?? 0);
  // Research links pass AutoPilot's suggested price; the seller's own markup wins if they set one.
  const initialPrice = cost > 0 ? listPriceFor(defaults, cost, 0, suggested) : suggested;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Create a listing</h1>
        <p className="mt-1 text-sm text-slate-400">
          Import, review the generated copy, then price and publish. Demo mode runs everything except the final call to
          eBay.
        </p>
      </div>
      <ListingWizard
        initialTitle={params.title ?? ""}
        initialCost={cost}
        initialPrice={initialPrice}
        adRatePct={defaults.adRatePct}
        markupPct={defaults.markupPct}
        hasFooter={Boolean(defaults.descriptionFooter)}
      />
    </div>
  );
}
