import { SourcingBoard } from "@/components/dashboard/SourcingBoard";
import { getCurrentUser } from "@/lib/auth";
import { connectedAccessToken } from "@/lib/listing-pipeline";
import { NICHES } from "@/lib/niches";
import { MIN_PROFIT_LABEL } from "@/lib/pricing";
import { getSourcingOverview } from "@/lib/sourcing";

export const dynamic = "force-dynamic";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [overview, token] = await Promise.all([getSourcingOverview(user.id), connectedAccessToken(user.id)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Products</h1>
        <p className="mt-1 text-sm text-slate-400">
          AutoPilot finds CJ products in your niches and checks each one exactly as a real listing would be checked:
          CJ&apos;s real shipping, your pricing rule with at least {MIN_PROFIT_LABEL} profit, the eBay market price, brand risk, and
          eBay&apos;s category and size rules. Only products that pass everything are shown, with the reasons the rest
          were turned down.
        </p>
      </div>

      <SourcingBoard
        niches={NICHES.map((n) => n.name)}
        selected={overview.settings.niches}
        enabled={overview.settings.enabled}
        lastRunAt={overview.settings.lastRunAt ? overview.settings.lastRunAt.toISOString() : null}
        waiting={overview.waiting}
        last24h={overview.last24h}
        ready={overview.ready}
        ebayConnected={Boolean(token)}
      />
    </div>
  );
}
