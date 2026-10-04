"use client";

import Link from "next/link";
import { useState } from "react";

const links = [
  { href: "/#bulk", label: "Bulk listing" },
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/#built-for", label: "Why AutoPilot" },
  { href: "/guide", label: "Setup guide" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-navy-950/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="eBay AutoPilot home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/mark.svg" alt="" width={34} height={34} className="h-[34px] w-[34px]" />
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-bold tracking-tight text-white">AutoPilot</span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-lime-brand">eBay automation</span>
          </span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-slate-300 transition hover:text-white">
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/login" className="text-sm font-medium text-slate-200 transition hover:text-white">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400"
          >
            Start free trial
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={open}
          className="rounded-lg border border-white/15 p-2 md:hidden"
        >
          <span className="block h-0.5 w-5 bg-white" />
          <span className="mt-1 block h-0.5 w-5 bg-white" />
          <span className="mt-1 block h-0.5 w-5 bg-white" />
        </button>
      </nav>

      {open ? (
        <div className="border-t border-white/10 px-5 pb-4 md:hidden">
          <div className="flex flex-col gap-3 pt-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="text-sm text-slate-300"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex gap-3">
              <Link href="/login" className="rounded-full border border-white/15 px-4 py-2 text-sm">
                Log in
              </Link>
              <Link href="/signup" className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold">
                Start free trial
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
