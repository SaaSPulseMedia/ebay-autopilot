import Link from "next/link";

import { Footer } from "@/components/landing/Footer";
import { Nav } from "@/components/landing/Nav";

export const metadata = {
  title: "Setup guide",
  description:
    "A plain-English setup guide for eBay AutoPilot. No developer account, no API keys, no technical knowledge needed.",
};

const steps = [
  {
    n: "1",
    time: "about 1 minute",
    title: "Create your AutoPilot account",
    body: [
      "Go to the sign-up page, enter your email address and a password, and that is it. You are not asked for a card and there is nothing to download or install.",
      "You land straight on your dashboard with a catalog of products already loaded, so there is nothing to set up before you can look around.",
    ],
    note: null,
  },
  {
    n: "2",
    time: "about 2 minutes",
    title: "Connect your eBay store",
    body: [
      "On your dashboard, open Settings and press the blue Connect eBay store button.",
      "You are taken to eBay's own website. You sign in there, the way you always do, and eBay shows you a screen asking whether you give AutoPilot permission to manage listings for your store. Press agree.",
      "eBay sends you straight back to AutoPilot and your store shows as connected. That is the whole setup.",
    ],
    note: "You type your eBay password into eBay's website, never into ours. We never see it. You can withdraw the permission from your own eBay account settings at any time, without asking us.",
  },
  {
    n: "3",
    time: "as long as you like",
    title: "Choose what you want to sell",
    body: [
      "Open Bulk list. You will see a table of products with what each one costs from the supplier, what we suggest you sell it for, and how much profit is left after eBay takes its fees.",
      "Tick the ones you like. You can tick one product or your whole batch. As you tick, the totals at the top update so you can see what the batch is worth before you commit to anything.",
    ],
    note: null,
  },
  {
    n: "4",
    time: "about 30 seconds per product",
    title: "Press the button",
    body: [
      "Press List selected. AutoPilot writes the title, the description and the item specifics for every product, builds out all the size and colour options, applies your pricing, and publishes them. Publishing straight to eBay is being switched on now — until it is, listings are created in demo mode and nothing is posted.",
      "You can close the tab. It keeps going in the background and the results appear under Listings when it is done.",
    ],
    note: null,
  },
  {
    n: "5",
    time: "a few minutes per sale",
    title: "When something sells",
    body: [
      "Sales recorded in your account appear on your Orders page with what the item cost you and what you actually made on it. Pulling new sales in from eBay automatically is still being built.",
      "You order the item from your wholesale or dropship supplier and have it delivered to the buyer, then add the tracking number to the order in eBay as you normally would. Sending tracking to eBay from AutoPilot is still being built.",
    ],
    note: null,
  },
];

const jargon = [
  {
    term: "API",
    plain:
      "A direct line between two pieces of software. AutoPilot uses one to talk to eBay so it can post your listings for you. You do not need to do anything with it.",
  },
  {
    term: "eBay developer account",
    plain:
      "A registration eBay gives to companies that build tools. We hold ours already. You do not need one and you cannot be asked for one.",
  },
  {
    term: "OAuth",
    plain:
      "The proper name for that permission screen on eBay where you press agree. It is the same thing that happens when a website offers to let you sign in with Google.",
  },
  {
    term: "Environment variable",
    plain:
      "A setting stored on our servers, such as our connection keys. This is our side of the fence. You will never see one.",
  },
  {
    term: "Chromium / headless browser",
    plain:
      "An optional backup method of posting listings that we are still building. It is switched off and it does not affect you.",
  },
  {
    term: "Demo mode",
    plain:
      "The safe sandbox you start in. Everything works exactly as it will for real, except nothing is actually posted to eBay. Good for having a look around first.",
  },
];

export default function GuidePage() {
  return (
    <>
      <Nav />
      <main>
        <section className="ap-grid-bg border-b border-white/10 py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-lime-brand/30 bg-lime-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-lime-brand">
              Setup guide
            </span>
            <h1 className="mt-5 text-[clamp(2.1rem,4.6vw,3.2rem)] font-extrabold leading-[1.06] tracking-tight text-white">
              You do not need to be technical
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              If you can sign in to eBay, you can set up eBay AutoPilot. There is nothing to install, no developer
              account to apply for, and no keys or settings to copy and paste anywhere. Here is the whole thing, start
              to finish, in plain English.
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-lime-brand/25 bg-lime-brand/[0.07] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-lime-brand">What you need</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-200">
                  <li>✓ An eBay seller account</li>
                  <li>✓ A wholesale or dropship supplier (not a retail store like Amazon or Walmart)</li>
                  <li>✓ An email address</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">What you do not need</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-400">
                  <li>✕ An eBay developer account</li>
                  <li>✕ API keys or any settings</li>
                  <li>✕ Any software installed</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-navy-900 py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-5">
            <h2 className="text-2xl font-bold tracking-tight text-white">The five steps</h2>
            <ol className="mt-8 space-y-5">
              {steps.map((step) => (
                <li key={step.n} className="ap-card rounded-2xl p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-base font-bold text-white">
                      {step.n}
                    </span>
                    <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                    <span className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-slate-400">{step.time}</span>
                  </div>
                  {step.body.map((paragraph) => (
                    <p key={paragraph} className="mt-3 text-sm leading-relaxed text-slate-300">
                      {paragraph}
                    </p>
                  ))}
                  {step.note ? (
                    <p className="mt-4 rounded-xl border border-lime-brand/25 bg-lime-brand/[0.07] px-4 py-3 text-sm leading-relaxed text-lime-brand">
                      {step.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-b border-white/10 bg-navy-950 py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-5">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Words you might see, and why they are not your problem
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-300">
              Software people use a lot of jargon. You do not need any of it to run your store, but in case you come
              across these terms, here is what they actually mean.
            </p>
            <dl className="mt-8 space-y-3">
              {jargon.map((item) => (
                <div key={item.term} className="ap-card rounded-2xl p-5">
                  <dt className="text-base font-semibold text-white">{item.term}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-slate-400">{item.plain}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="ap-grid-bg py-16 lg:py-20">
          <div className="mx-auto max-w-3xl px-5 text-center">
            <h2 className="text-[clamp(1.7rem,3.4vw,2.4rem)] font-extrabold tracking-tight text-white">
              Stuck at any point? We will do it with you.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-300">
              If anything here is unclear, email us and we will walk you through connecting your store and getting your
              first batch live. We would rather spend twenty minutes helping you set it up properly than have you give
              up on step two.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="ap-glow rounded-full bg-brand-500 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-brand-400"
              >
                Start your 3-day free trial
              </Link>
              <Link
                href="/#faq"
                className="rounded-full border border-white/20 px-7 py-3.5 text-base font-semibold text-slate-100 transition hover:border-white/40 hover:bg-white/5"
              >
                Read the FAQ
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
