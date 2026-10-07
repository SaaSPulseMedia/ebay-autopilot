const faqs = [
  {
    q: "Can I really list products in bulk with one click?",
    a: "That is the main thing the product does. Tick the products you want in the research feed, or paste a list of supplier URLs, and press List selected. AutoPilot writes each listing, expands the variants, applies your pricing, screens out brand-name products, and publishes the whole batch. The same engine handles a single product and a full batch, so there is no separate workflow for bulk. Every plan lists up to 50 products per run; plans differ by how many listings you can keep live (50, 200, or 1,000).",
  },
  {
    q: "Does it handle variants, or only single-quantity listings?",
    a: "It builds variants. Size, color, and style options from the supplier are expanded into a proper multi-variant eBay listing, with its own SKU, price, and quantity on every row. Variants are the reason a single product can take half an hour to list by hand, so this is the part we automate hardest. Every plan covers up to 20 variants per product.",
  },
  {
    q: "I am not technical at all. Can I still use this?",
    a: "Yes, and this is the part we care most about getting right. There is nothing to install, nothing to configure, and no developer account to apply for. You need two things: an eBay seller account and somewhere to buy your products from. Setup is create an account, press Connect eBay store, approve on eBay's screen, and start listing — most people are done in under five minutes. We also wrote a plain-English setup guide with no jargon in it, and if you get stuck at any point you can email us and we will walk you through it.",
  },
  {
    q: "Can I use Amazon or Walmart as my supplier?",
    a: "No, and AutoPilot will not let you. eBay allows dropshipping from a wholesale supplier, but it does not allow listing an item and then buying it from another retailer or marketplace to ship to your buyer. Sellers get listings removed or accounts restricted for it. Links to retail stores like Amazon, Walmart, or Target are skipped automatically. AliExpress is only acceptable through its official dropshipping program. Use a wholesale or dropship supplier instead.",
  },
  {
    q: "Does AutoPilot publish listings directly on eBay?",
    a: "That is what it is built to do: once your store is connected, listings will appear on eBay as listings from your own shop, under your account. Connecting through eBay's official sign-in is built; publishing straight to eBay is being finished now. Until it is switched on, AutoPilot runs in demo mode — research, pricing, AI copy, variants, the lot — and nothing is posted to eBay.",
  },
  {
    q: "How much work is left after I connect my store?",
    a: "You choose what to sell, you review the batch before it goes out, and you place the supplier order when something sells. The typing is gone: pricing after fees, writing every listing, building variants, brand screening, and publishing all happen for you. Re-checking supplier prices, pausing out-of-stock items, and pulling sales in from eBay automatically are in progress. If you currently pay someone to do your listings, this is the job it replaces.",
  },
  {
    q: "Do I need an eBay developer account, or any technical setup?",
    a: "No. None at all. We hold the eBay developer application on our side — that is our job, not yours. Connecting your store takes one click: you press Connect eBay store, eBay shows you its own sign-in and permission screen, you press agree, and you land back in AutoPilot connected. You will never see an API key, a redirect URI, or a line of configuration. If you can sign in to eBay, you can set up AutoPilot."
  },
  {
    q: "What does the AI actually write for me?",
    a: "An eBay title trimmed to the 80-character limit, four benefit bullets, a plain-text description, and a starting set of item specifics such as condition, brand, and ships-from. It is instructed never to invent certifications, ratings, or endorsements. If no AI key is configured on the deployment, a deterministic template produces the same fields so the wizard never dead-ends. You can edit every field before publishing.",
  },
  {
    q: "How are margins calculated?",
    a: "From the real cost stack, not a flat markup. We take your list price, subtract the supplier cost, subtract shipping if the supplier charges it, then subtract eBay's final value fee of 13.55% plus the $0.40 per-order fee. What is left is the net profit shown on the product row, and the margin percentage is that net profit over the list price. Your own payment-processing or promoted-listing costs are yours to add on top.",
  },
  {
    q: "Can I run multiple eBay stores?",
    a: "Yes. Starter covers one store, Pro covers three, and Business covers ten. Switching between several connected stores inside one dashboard is in progress.",
  },
  {
    q: "What happens when I get a sale?",
    a: "Sales recorded in your account appear on the orders board with the sale price, supplier cost, and realized margin, and feed your analytics totals. Pulling new sales in from eBay automatically, and sending tracking numbers back to eBay, are in progress. Until then you place the supplier order and handle tracking in eBay as you do today.",
  },
  {
    q: "Do you store my eBay password?",
    a: "No. When you connect your store the normal way, you type your password into eBay's own website, not ours — we never see it. eBay hands us back a permission token instead, and you can cancel that token from your eBay account settings at any time, without asking us. The only exception would be a future opt-in mode that signs in on your behalf; if you ever chose that, the credentials would be encrypted at rest with AES-256-GCM and deletable in one click. That mode is off today.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from the billing page and you keep access until the end of the period you have already paid for; nothing renews after that. The three-day trial does not ask for a card, so if you walk away during the trial there is nothing to cancel. Your listings stay on eBay — they belong to your store, not to us.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="border-b border-white/10 bg-navy-900 py-20 lg:py-24">
      <div className="mx-auto max-w-4xl px-5">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">Questions</p>
          <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,2.7rem)] font-bold leading-tight tracking-tight text-white">
            Straight answers before you sign up
          </h2>
        </div>

        <div className="mt-10 space-y-3">
          {faqs.map((faq, index) => (
            <details
              key={faq.q}
              open={index === 0}
              className="ap-card group rounded-2xl p-5 transition open:border-brand-500/40"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-white">
                {faq.q}
                <span
                  aria-hidden
                  className="shrink-0 text-xl leading-none text-brand-400 transition group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
