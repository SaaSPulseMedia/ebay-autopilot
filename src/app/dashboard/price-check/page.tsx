import { PriceCheck } from "@/components/dashboard/PriceCheck";
import { getCurrentUser } from "@/lib/auth";
import { connectedAccessToken } from "@/lib/listing-pipeline";

export const dynamic = "force-dynamic";

export const metadata = { title: "Price check" };

export default async function PriceCheckPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const token = await connectedAccessToken(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Price check</h1>
        <p className="mt-1 text-sm text-slate-400">
          For each of your eBay listings, AutoPilot compares what buyers pay you (price + shipping) with what they find for the
          same search on eBay, and tells you whether price is what stops them buying. It works on every listing in your store,
          including ones not made in AutoPilot. Nothing on eBay is changed: you decide what to reprice.
        </p>
      </div>
      <PriceCheck ebayConnected={Boolean(token)} />
    </div>
  );
}
