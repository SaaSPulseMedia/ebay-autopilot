import { ListingWizard } from "@/components/dashboard/ListingWizard";

export const dynamic = "force-dynamic";

export const metadata = { title: "New listing" };

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; cost?: string; price?: string }>;
}) {
  const params = await searchParams;

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
        initialCost={Number(params.cost ?? 0)}
        initialPrice={Number(params.price ?? 0)}
      />
    </div>
  );
}
