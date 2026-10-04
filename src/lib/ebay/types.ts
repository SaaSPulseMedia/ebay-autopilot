export type ListingEngine = "api" | "browser" | "demo";

export type ListingDraft = {
  title: string;
  description: string;
  listPrice: number;
  supplierPrice: number;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  quantity?: number;
};

export type ListingResult = {
  engine: ListingEngine;
  status: "published" | "queued" | "unavailable" | "error";
  message: string;
  itemId: string | null;
  title: string;
};

export const ENGINES: { id: ListingEngine; label: string; blurb: string }[] = [
  { id: "api", label: "eBay API", blurb: "Official Sell API over OAuth. Used automatically once your store is connected." },
  { id: "browser", label: "Browser fallback", blurb: "Headless Chromium posts through the normal seller flow. Scaffolded, not enabled yet." },
  { id: "demo", label: "Demo mode", blurb: "Everything runs except the final publish call. Nothing touches eBay." },
];
