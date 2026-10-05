# eBay AutoPilot

**Run your eBay store on autopilot.**

Listing is the job every eBay store owner hates: retyping the title into an 80-character box, filling 20+ item
specifics, re-uploading photos, and building every size and color variant by hand — per product. It is the most
commonly outsourced task in the business.

**eBay AutoPilot replaces that work with one button.** Select up to 50 products, press *List selected*, and the
batch is written by AI, variant-expanded, brand-screened, priced after real eBay fees, and published. Repricing, stock
sync, and automatic order ingestion are in progress.

Built with Next.js 16 (App Router), Drizzle ORM, and PostgreSQL.

---

## What it does

| Area | Detail |
| --- | --- |
| **Bulk listing** | **The core feature. Tick any number of products and publish the whole batch in one run — the same engine handles 1 or 200** |
| **Variants** | **Size, color, and style options expanded into proper multi-variant listings, each row with its own SKU, price, and quantity** |
| Research | Supplier catalog with cost, suggested eBay price, shipping, and net profit after eBay's 13.55% final value fee and $0.40 per-order fee |
| Import | Paste a supplier URL; the server fetches the page and reads title, price, and image from the markup |
| AI copy | Claude drafts an 80-character title, bullets, description, and item specifics, with a deterministic template fallback |
| Publishing | Official eBay Sell API (OAuth), headless-Chromium fallback (scaffolded), and demo mode that skips only the final call |
| Plan limits | Active listings are the upgrade driver: 50 on Starter, 200 on Pro, 1,000 on Business. Batch size: 50 per run and up to 20 variants per product on every plan. Limits enforced server-side (non-ended listings counted, typed `plan_limit_reached` error) |
| Maintenance | Built: VeRO brand screening on every listing (`src/lib/vero.ts`). In progress: supplier re-checks, repricing rules, out-of-stock pause, spaced posting cadence |
| Orders | Fulfillment queue with buyer details, supplier cost, and realized margin, feeding the analytics totals |
| Billing | Stripe Checkout with a demo fallback so the flow is clickable before live keys are added |

Every number shown in the product is computed from the data in that deployment. There are no placeholder metrics and
no testimonials.

## Stack

- Next.js 16 App Router — Server Components for all data reads, `"use client"` only for interactive forms
- Drizzle ORM + PostgreSQL
- Tailwind CSS v4
- `jose` JWT sessions + `bcryptjs` password hashing, HTTP-only cookies
- Server-only secrets: every API key is read in route handlers or server modules and never reaches the client bundle

## Getting started

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and AUTH_SECRET
npm run db:push             # create tables
npm run db:seed             # load the supplier catalog
npm run dev
```

Open http://localhost:3000.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply the Drizzle schema |
| `npm run db:seed` | Seed the supplier catalog |

## Environment variables

Required:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Signing key for session JWTs (`openssl rand -base64 32`) |

Optional — each has a working fallback:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_BASE_URL` | Canonical site URL for metadata and Stripe redirects |
| `ANTHROPIC_API_KEY` | Claude listing copy; falls back to the built-in template |
| `ANTHROPIC_MODEL` | Override the Claude model |
| `STRIPE_SECRET_KEY` | Live Stripe Checkout; falls back to demo checkout |
| `RAINFOREST_API_KEY` | Amazon supplier feed |
| `RAPIDAPI_KEY` | Alternate supplier feed |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_REDIRECT_URI` | eBay OAuth app credentials |
| `EBAY_SANDBOX` | `true` to target eBay sandbox |
| `ENABLE_BROWSER_ENGINE` / `CHROMIUM_EXECUTABLE_PATH` | Enable the headless-Chromium fallback (not implemented yet) |

## Who sets up what

This trips people up, so to be explicit:

| | You (the operator), once | Your customers, ever |
| --- | --- | --- |
| eBay developer account | **Yes** — register one free app at [developer.ebay.com](https://developer.ebay.com) | **No. Never.** |
| eBay app keys (`EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`) | **Yes** — paste into Vercel env vars | **No** |
| Redirect URI | **Yes** — set it to `https://yourdomain.com/api/ebay/callback` | **No** |
| Connecting a store | Not applicable | **One click.** Press *Connect eBay store*, approve on eBay's screen, done |

You register **one** eBay application for the whole product. Every customer then authorises *your* application against
*their* own eBay account through eBay's standard permission screen — the same flow as "Sign in with Google". A
customer never sees a key, a redirect URI, or any configuration, and they never type their eBay password into our
site.

Until you add the eBay keys, the app runs every customer in demo mode: the full pipeline works and nothing is posted
to eBay.

### Your one-time eBay setup

1. Sign in at [developer.ebay.com](https://developer.ebay.com) with your normal eBay account and join the developer
   program (free).
2. Create a **Production** keyset. Note the App ID (client ID) and Cert ID (client secret).
3. Add an **RuName / redirect URI** pointing at `https://yourdomain.com/api/ebay/callback`.
4. Put `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, and `EBAY_REDIRECT_URI` into your Vercel environment variables.
5. Redeploy. The Connect button now does a real connection for every customer.

## Deploying to Vercel

1. Import the repository on [vercel.com/new](https://vercel.com/new).
2. Add `AUTH_SECRET` on the Configure Project screen before the first deploy.
3. After the first deploy, add Neon Postgres from the **Storage** tab — it injects `DATABASE_URL`.
4. Apply the schema and seed the catalog from your machine:
   ```bash
   vercel link && vercel env pull .env.production
   DATABASE_URL="$(grep DATABASE_URL .env.production | cut -d= -f2-)" npx drizzle-kit push
   DATABASE_URL="$(grep DATABASE_URL .env.production | cut -d= -f2-)" npm run db:seed
   ```
5. Add `NEXT_PUBLIC_BASE_URL` with your production URL and redeploy.

Serverless function memory stays at the default 1024 MB — Chromium is not bundled in this release, so any
"missing Chromium" warning is expected and safe to ignore.

## Roadmap

- Real eBay OAuth token exchange and Sell API publishing
- Encrypted-credentials table and the headless-Chromium listing engine
- Scheduled order ingestion and tracking upload

## Honesty policy

No invented testimonials, no fabricated user counts, no superlative claims. Marketing figures are either generic
truthful statements or values computed at request time from the running deployment. CI fails the build if
unverifiable social-proof strings reappear in `README.md`, `src/`, or `public/`.

eBay AutoPilot is not affiliated with, endorsed by, or sponsored by eBay Inc.

## License

MIT — see [LICENSE](./LICENSE).
