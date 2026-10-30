import type { Variant } from "@/lib/variants";

export type ListingEngine = "api" | "browser" | "demo";

export type ListingDraft = {
  title: string;
  description: string;
  listPrice: number;
  supplierPrice: number;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  /** All images for the listing, primary first. When empty, `imageUrl` alone is used. */
  imageUrls?: string[];
  quantity?: number;
  /** Real supplier variants; two or more are published as one multi-variation eBay listing. */
  variations?: Variant[];
  /** Priced by "Match eBay Market Price (Free Shipping)": publish with the seller's free-shipping policy. */
  freeShipping?: boolean;
  /** Clothing and shoes: CJ's size chart images, embedded in the description HTML (see src/lib/size-chart.ts). */
  sizeChartImages?: string[];
  /** Clothing and shoes: CJ's sizing warnings, shown under the size chart in the description. */
  sizeNotes?: string[];
  /** CJ's product video URL, uploaded to eBay with the listing (never fatal when eBay won't take it). */
  videoUrl?: string | null;
  /** The seller chose "List anyway": publish even when the price is over 20% above the eBay average (Market Guard). */
  allowAboveMarket?: boolean;
};

export type ListingResult = {
  engine: ListingEngine;
  status: "published" | "queued" | "unavailable" | "error";
  message: string;
  itemId: string | null;
  title: string;
  /** Variants on the published eBay listing, when the engine reports it (1 = single listing). */
  variations?: number;
};

export const ENGINES: { id: ListingEngine; label: string; blurb: string }[] = [
  { id: "api", label: "eBay API", blurb: "Official Sell API over OAuth. Used automatically once your store is connected." },
  { id: "browser", label: "Browser fallback", blurb: "Headless Chromium posts through the normal seller flow. Scaffolded, not enabled yet." },
  { id: "demo", label: "Demo mode", blurb: "Everything runs except the final publish call. Nothing touches eBay." },
];
