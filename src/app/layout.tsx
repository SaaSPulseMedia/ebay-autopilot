import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "eBay AutoPilot — Run your eBay store on autopilot",
    template: "%s · eBay AutoPilot",
  },
  description:
    "Bulk-list products on eBay in one click. eBay AutoPilot writes the copy, builds every variant, prices after eBay fees, and publishes individually or in bulk — then keeps listings in stock and repriced.",
  applicationName: "eBay AutoPilot",
  keywords: [
    "eBay bulk listing software",
    "automated eBay listing",
    "eBay variant listing tool",
    "eBay dropshipping automation",
    "eBay lister",
    "US eBay sellers",
  ],
  openGraph: {
    type: "website",
    url: baseUrl,
    siteName: "eBay AutoPilot",
    title: "eBay AutoPilot — Run your eBay store on autopilot",
    description:
      "Bulk-list products on eBay in one click. AI listing copy, automatic variant building, pricing after eBay fees, and hourly stock and price sync.",
    images: [{ url: "/images/logo.svg", width: 260, height: 64, alt: "eBay AutoPilot" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "eBay AutoPilot — Run your eBay store on autopilot",
    description:
      "Bulk-list products on eBay in one click, with AI listing copy and automatic variant building.",
    images: ["/images/logo.svg"],
  },
  icons: { icon: "/images/mark.svg" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-navy-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
