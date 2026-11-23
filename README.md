# Belfield Hunt Liam

[Open the rental map](https://belfield-hunt-liam.vercel.app/map)

Private, shared hub for a group of 2–5 UCD students to find, triage, rank, compare and contact
Dublin rental listings from Daft.ie **as fast as possible** after they appear.

- **Scraping:** Select **Find rentals** to run a full sweep with Apify. Results arrive through the webhook.
- **App:** Next.js (App Router, TypeScript strict) on Vercel Hobby, Supabase (Postgres, Auth,
  Realtime, RLS), MapLibre + OpenFreeMap, TFI GTFS for transit layers, Google Routes server-side.
- **Notifications:** Telegram bot with inline buttons, optional Web Push, daily 09:00 digest.

## Quick start (local)

```bash
pnpm install
cp .env.example .env.local      # fill in values (see docs/SETUP.md)
pnpm supabase start             # local Postgres/Auth via Docker (optional)
pnpm dev
```

## Scripts

| Script                             | What it does                                                |
| ---------------------------------- | ----------------------------------------------------------- |
| `pnpm dev` / `build` / `start`     | Next.js                                                     |
| `pnpm typecheck` / `lint` / `test` | tsc, ESLint, Vitest                                         |
| `pnpm test:e2e`                    | Playwright (needs local Supabase, see docs/SETUP.md)        |
| `pnpm test:secrets`                | Greps the `.next` build output for server secrets           |
| `pnpm check`                       | All of the above except e2e                                 |
| `pnpm setup:apify`                 | Idempotently create/update Apify tasks, schedules, webhooks |
| `pnpm ingest:dataset <id>`         | Replay an Apify dataset through the ingestion pipeline      |
| `pnpm transit:refresh`             | Rebuild `public/transit/*` from the TFI GTFS feed (monthly) |
| `pnpm db:push`                     | Apply Supabase migrations to the linked project             |

## Docs

- [docs/SETUP.md](docs/SETUP.md) — step-by-step deployment + troubleshooting
- [docs/DECISIONS.md](docs/DECISIONS.md) — design decisions and their reasons
- [docs/COSTS.md](docs/COSTS.md) — cost model (Apify, Google), free tiers and kill switches
