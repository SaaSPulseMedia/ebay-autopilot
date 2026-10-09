import { CheckoutButtons } from "@/components/dashboard/CheckoutButtons";
import { getCurrentUser } from "@/lib/auth";
import { isStripeConfigured } from "@/lib/stripe/client";
import { getSubscriptionForUser, isLiveSubscription } from "@/lib/stripe/subscriptions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Billing" };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left on the free trial (0 once it has ended). */
function trialDaysRemaining(endsAt: Date, now: number) {
  return Math.max(0, Math.ceil((endsAt.getTime() - now) / DAY_MS));
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;

  const subscription = isStripeConfigured() ? await getSubscriptionForUser(user.id) : null;
  const trialDaysLeft = user.trialEndsAt ? trialDaysRemaining(user.trialEndsAt, new Date().getTime()) : 0;

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
        {params.status === "success" ? (
          <p className="mt-3 rounded-xl border border-lime-brand/30 bg-lime-brand/10 px-3 py-2 text-lime-brand">
            Payment received — thanks for subscribing. Your plan updates as soon as Stripe confirms it (usually within
            a few seconds); refresh this page if it still shows your old plan.
          </p>
        ) : null}
        {params.status === "cancelled" ? (
          <p className="mt-3 rounded-xl border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-slate-300">
            Checkout was cancelled. Nothing was charged and your plan is unchanged.
          </p>
        ) : null}
        {params.error !== undefined ? (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-200">
            Something went wrong with billing. Nothing was charged — please try again.
          </p>
        ) : null}
      </div>

      <CheckoutButtons currentPlan={user.plan} hasSubscription={isLiveSubscription(subscription)} />
    </div>
  );
}
