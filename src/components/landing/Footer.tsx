import Link from "next/link";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#how", label: "How it works" },
      { href: "/guide", label: "Setup guide" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "App",
    links: [
      { href: "/signup", label: "Start free trial" },
      { href: "/login", label: "Log in" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/dashboard/billing", label: "Billing" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/privacy", label: "Privacy" },
      { href: "https://github.com/SaaSPulseMedia/ebay-autopilot", label: "Source" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-navy-950 py-14">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5" aria-label="eBay AutoPilot home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/mark.svg" alt="" width={34} height={34} className="h-[34px] w-[34px]" />
              <span className="flex flex-col leading-none">
                <span className="text-[15px] font-bold tracking-tight text-white">AutoPilot</span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-lime-brand">
                  eBay automation
                </span>
              </span>
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              eBay AutoPilot is dropshipping automation for US eBay sellers. Research, listing copy, publishing,
              repricing, and order handling in one dashboard.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {columns.map((column) => (
              <div key={column.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{column.title}</p>
                <ul className="mt-3 space-y-2">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-sm text-slate-400 transition hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} eBay AutoPilot. All rights reserved.</p>
          <p>
            Not affiliated with, endorsed by, or sponsored by eBay Inc. &quot;eBay&quot; is a trademark of its
            respective owner.
          </p>
        </div>
      </div>
    </footer>
  );
}
