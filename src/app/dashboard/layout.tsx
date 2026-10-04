import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/bulk", label: "⚡ Bulk list" },
  { href: "/dashboard/research", label: "Research" },
  { href: "/dashboard/listings", label: "Listings" },
  { href: "/dashboard/listings/new", label: "New listing" },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-navy-950">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/mark.svg" alt="" width={30} height={30} className="h-[30px] w-[30px]" />
            <span className="text-sm font-bold tracking-tight text-white">AutoPilot</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-400 sm:inline">{user.email}</span>
            <span className="rounded-full border border-lime-brand/30 bg-lime-brand/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-lime-brand">
              {user.plan}
            </span>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                Log out
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-7xl overflow-x-auto px-5 pb-2">
          <nav className="flex gap-1.5">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] text-slate-300 transition hover:bg-white/8 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
