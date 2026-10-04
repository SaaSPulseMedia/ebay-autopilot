import { CheckoutButtons } from "@/components/dashboard/CheckoutButtons";
import { getCurrentUser } from "@/lib/auth";
import { isStripeConfigured } from "@/lib/billing";

export const dynamic = "force-dynamic";

export const metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ demo?: string; status?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;

  const trialDaysLeft = user.trialEndsAt
    ? Math.max(0, Math.ceil((user.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Billing</h1>
        <p className="mt-1 text-sm text-slate-400">
          Launch pricing, billed monthly in USD. Cancel any time — access runs to the end of the paid period.
        </p>
      </div>

      <div className="ap-card rounded-2xl p-5 text-sm">
        <p className="text-slate-300">
          Current plan: <span className="font-semibold text-white">{user.plan}</span>
          {user.plan === "trial" ? ` · ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left` : null}
        </p>
        <p className="mt-2 text-slate-400">
          {isStripeConfigured()
            ? "Stripe is configured on this deployment — checkout opens a live Stripe session."
            : "Stripe keys are not set on this deployment, so checkout runs in demo mode and no card is charged."}
        </p>
        {params.demo ? (
          <p className="mt-3 rounded-xl border border-lime-brand/30 bg-lime-brand/10 px-3 py-2 text-lime-brand">
            Demo checkout completed for the {params.demo === "1" ? "selected" : params.demo} plan. Nothing was billed.
          </p>
        ) : null}
        {params.status === "success" ? (
          <p className="mt-3 rounded-xl border border-lime-brand/30 bg-lime-brand/10 px-3 py-2 text-lime-brand">
            Payment confirmed. Thanks for subscribing.
          </p>
        ) : null}
      </div>

      <CheckoutButtons currentPlan={user.plan} />
    </div>
  );
}
