"use client";

import type { CjCategory } from "@/lib/cj/catalog";

/** Filter values as typed (inputs stay strings; blank = no limit). */
export type SourceFilterValues = {
  category: string;
  minPrice: string;
  maxPrice: string;
  warehouse: "any" | "US" | "CN";
  minSellers: string;
  maxSellers: string;
};

export const EMPTY_FILTERS: SourceFilterValues = {
  category: "",
  minPrice: "",
  maxPrice: "",
  warehouse: "any",
  minSellers: "",
  maxSellers: "",
};

const STORAGE_KEY = "autopilot.source.filters";

/** Last used filters from localStorage; empty filters when unavailable or invalid. */
export function loadSavedFilters(): SourceFilterValues {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_FILTERS;
    const saved = JSON.parse(raw) as Partial<SourceFilterValues>;
    const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : "");
    return {
      category: text(saved.category),
      minPrice: text(saved.minPrice),
      maxPrice: text(saved.maxPrice),
      warehouse: saved.warehouse === "US" || saved.warehouse === "CN" ? saved.warehouse : "any",
      minSellers: text(saved.minSellers),
      maxSellers: text(saved.maxSellers),
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

export function saveFilters(filters: SourceFilterValues) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Private mode or storage blocked: filters just won't be remembered.
  }
}

/** Blank or invalid → null; negatives are treated as blank. */
export function parseLimit(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type FilterableItem = { price: number; listedNum: number; category: string; origin: "US" | "CN" | null };

/** Applies every filter in code to the results already loaded (no CJ calls). */
export function applySourceFilters<T extends FilterableItem>(items: T[], f: SourceFilterValues, categories: CjCategory[]): T[] {
  const minPrice = parseLimit(f.minPrice);
  const maxPrice = parseLimit(f.maxPrice);
  const minSellers = parseLimit(f.minSellers);
  const maxSellers = parseLimit(f.maxSellers);
  const selected = f.category ? categories.find((c) => c.name === f.category) : null;
  const categoryNames = selected
    ? new Set([selected.name, ...selected.subcategoryNames].map((n) => n.toLowerCase()))
    : null;

  return items.filter((item) => {
    if (minPrice != null && item.price < minPrice) return false;
    if (maxPrice != null && item.price > maxPrice) return false;
    if (minSellers != null && item.listedNum < minSellers) return false;
    if (maxSellers != null && item.listedNum > maxSellers) return false;
    if (f.warehouse !== "any" && item.origin !== f.warehouse) return false;
    // Category names load from CJ; until they do, a saved category can't be checked, so it doesn't hide anything.
    if (categoryNames && !categoryNames.has(item.category.toLowerCase())) return false;
    return true;
  });
}

type Chip = { key: string; label: string; clear: Partial<SourceFilterValues> };

const usd = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

function rangeLabel(min: number | null, max: number | null, fmt: (n: number) => string) {
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `up to ${fmt(max)}`;
  return null;
}

export function activeFilterChips(f: SourceFilterValues): Chip[] {
  const chips: Chip[] = [];
  if (f.category) chips.push({ key: "category", label: `Category: ${f.category}`, clear: { category: "" } });
  const price = rangeLabel(parseLimit(f.minPrice), parseLimit(f.maxPrice), usd);
  if (price) chips.push({ key: "price", label: `Price: ${price}`, clear: { minPrice: "", maxPrice: "" } });
  if (f.warehouse !== "any") {
    chips.push({ key: "warehouse", label: f.warehouse === "US" ? "Ships from US" : "Ships from China", clear: { warehouse: "any" } });
  }
  const sellers = rangeLabel(parseLimit(f.minSellers), parseLimit(f.maxSellers), (n) => n.toLocaleString());
  if (sellers) chips.push({ key: "sellers", label: `Sellers: ${sellers}`, clear: { minSellers: "", maxSellers: "" } });
  return chips;
}

const INPUT =
  "w-full rounded-lg border border-white/15 bg-navy-900 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-brand-500";
const LABEL = "mb-1 block text-xs font-medium text-slate-400";

type PanelProps = {
  filters: SourceFilterValues;
  onChange: (patch: Partial<SourceFilterValues>) => void;
  onClear: () => void;
  categories: { status: "idle" | "loading" | "error" | "done"; list: CjCategory[] };
  onRetryCategories: () => void;
};

export function SourceFilterPanel({ filters, onChange, onClear, categories, onRetryCategories }: PanelProps) {
  return (
    <div id="source-filters" className="ap-card space-y-4 rounded-2xl p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="f-category" className={LABEL}>
            Category
          </label>
          <select
            id="f-category"
            value={filters.category}
            onChange={(e) => onChange({ category: e.target.value })}
            disabled={categories.status !== "done"}
            className={INPUT}
          >
            <option value="">
              {categories.status === "loading" ? "Loading categories…" : categories.status === "error" ? "Couldn't load" : "Any category"}
            </option>
            {filters.category && !categories.list.some((c) => c.name === filters.category) ? (
              <option value={filters.category}>{filters.category}</option>
            ) : null}
            {categories.list.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          {categories.status === "error" ? (
            <button type="button" onClick={onRetryCategories} className="mt-1 text-xs text-brand-400 hover:text-brand-500">
              Retry loading categories
            </button>
          ) : null}
        </div>

        <fieldset>
          <legend className={LABEL}>Price (USD)</legend>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="Min"
              aria-label="Minimum price"
              value={filters.minPrice}
              onChange={(e) => onChange({ minPrice: e.target.value })}
              className={INPUT}
            />
            <span className="text-slate-500">–</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="Max"
              aria-label="Maximum price"
              value={filters.maxPrice}
              onChange={(e) => onChange({ maxPrice: e.target.value })}
              className={INPUT}
            />
          </div>
        </fieldset>

        <div>
          <label htmlFor="f-warehouse" className={LABEL}>
            Warehouse
          </label>
          <select
            id="f-warehouse"
            value={filters.warehouse}
            onChange={(e) => onChange({ warehouse: e.target.value as SourceFilterValues["warehouse"] })}
            className={INPUT}
          >
            <option value="any">Any</option>
            <option value="US">US only</option>
            <option value="CN">China only</option>
          </select>
        </div>

        <fieldset>
          <legend className={LABEL}>Sellers listing it</legend>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="1"
              placeholder="Min"
              aria-label="Minimum sellers"
              value={filters.minSellers}
              onChange={(e) => onChange({ minSellers: e.target.value })}
              className={INPUT}
            />
            <span className="text-slate-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="1"
              placeholder="Max"
              aria-label="Maximum sellers"
              value={filters.maxSellers}
              onChange={(e) => onChange({ maxSellers: e.target.value })}
              className={INPUT}
            />
          </div>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>Filters apply instantly to these results. Price and seller limits are also sent to CJ on your next search.</span>
        <button type="button" onClick={onClear} className="font-semibold text-brand-400 hover:text-brand-500">
          Clear all filters
        </button>
      </div>
    </div>
  );
}

export function SourceFilterChips({
  filters,
  onChange,
  onClear,
}: {
  filters: SourceFilterValues;
  onChange: (patch: Partial<SourceFilterValues>) => void;
  onClear: () => void;
}) {
  const chips = activeFilterChips(filters);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-brand-500/40 bg-brand-500/10 py-1 pl-3 pr-1 text-xs text-slate-200"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onChange(chip.clear)}
            aria-label={`Remove filter: ${chip.label}`}
            className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="text-xs font-semibold text-brand-400 hover:text-brand-500">
        Clear all filters
      </button>
    </div>
  );
}
