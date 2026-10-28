/** Plain-words eBay demand for the Products page (shared by server and browser). */
export function demandLabel(sold: number | null, listings: number | null) {
  const wanted =
    sold == null
      ? null
      : sold >= 100
        ? "Selling well on eBay"
        : sold >= 20
          ? "Some sales on eBay"
          : "Few sales on eBay";
  const crowd =
    listings == null
      ? null
      : listings < 500
        ? "few competitors"
        : listings < 5000
          ? "some competition"
          : "crowded";
  const tone =
    sold == null
      ? "neutral"
      : sold >= 100 && (listings ?? 0) < 5000
        ? "good"
        : sold < 20
          ? "weak"
          : "neutral";
  return { wanted, crowd, tone } as const;
}
