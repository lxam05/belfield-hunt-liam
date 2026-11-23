# Costs

Everything here is computed live on **Settings → Costs** (`/settings/costs`) from the counters in
the `api_usage` and `scrape_runs` tables. This page explains the model behind those numbers.

## Apify (the only thing that will realistically cost money)

Actor `shahidirfan/Daft-ie-Property-Scraper` is **pay per event**:

| Event | Price |
|---|---|
| Result (one listing) | $0.001 |
| Actor start (per GB of memory; we use 1024 MB → 1 start event) | $0.0005 |
| Compute (≈4 s, ≈0.0012 CU per fast-lane run) | ≈ $0.001 |

Per fast-lane run ≈ 10 × $0.001 + $0.0005 + $0.001 ≈ **$0.012**.

| Fast-lane cadence (07:00–23:00 Dublin) | Runs/day | ≈ $/month | + nightly sweep ≈ $4.60 |
|---|---|---|---|
| every 15 min | 64 | ~$23 | ~$28 |
| every 20 min | 48 | ~$17 | ~$22 |
| **every 30 min (default)** | 32 | ~$12 | **~$16** |
| hourly | 17 | ~$6 | ~$11 |

- The **Apify Free plan's $5/month only covers a run every ~2–3 h.** The 30-minute default needs
  the paid **Starter** plan. Change the cadence in Settings → Search; "Apply to Apify" updates the
  Schedule through the API.
- Use automatic proxy (`{ "useApifyProxy": true }`): free, works for Daft. The DATACENTER group is
  rejected on the Free plan, and RESIDENTIAL costs $8/GB, so never use it.
- `results_wanted` is a **global** cap across all URLs in a run, so the fast lane uses one
  combined URL. The sweep (4 URLs, 300 results) costs ≈ $0.15 per night.
- When Apify reports `usageTotalUsd` on the run, we store that exact figure. Otherwise we store
  the estimate above (`lib/costs.ts`).
- "Scrape now" is rate-limited to one manual run per 2 minutes.

## Google Maps Platform (should stay at $0)

Prices from Google's pricing page and Routes SKU details (checked 2026-11-20):

| SKU | Free per month | Then (per 1,000) |
|---|---|---|
| Routes: **Compute Routes Essentials** | 10,000 | $5.00 (up to 100k) |
| Routes: Compute Routes Pro | 5,000 | $10.00 |
| Geocoding (Essentials) | 10,000 | $5.00 (up to 100k) |

**How we stay on the Essentials SKU.** A request is billed at the highest SKU any of its features
triggers. Pro is triggered by `TRAFFIC_AWARE`/`TRAFFIC_AWARE_OPTIMAL` routing, 11–25 waypoints,
waypoint optimisation, or location modifiers such as side of road, heading or vehicle stopover.
Enterprise is triggered by two-wheeled (motorbike) routing, tolls, traffic on polylines, or large
vehicles. `lib/enrich/routes.ts` uses none of these:

- `TRANSIT` with a **fixed future** departure time (next weekday 08:30, return 18:00). We never
  use "now", because real-time traffic is billed higher.
- `BICYCLE` and `WALK` (walk only when the straight-line distance is under 3 km).
- Field masks ask only for duration, distance, step modes/durations and transit line names.

> Google's docs don't explicitly say whether `BICYCLE` counts as "two-wheeled vehicle routing"
> (that wording appears to mean `TWO_WHEELER`, i.e. motorbikes). Check the SKU column in the
> Cloud console's billing report after the first week. If bicycle calls show up as Enterprise
> (1,000 free), lower `GOOGLE_MONTHLY_CALL_LIMIT` or rely on the bike estimator.

**Expected volume:** ~30 new listings/day × 2 destinations × (transit + return + bicycle, plus
walk when close) ≈ 5,400–6,000 Routes calls and ≈ 900 geocodes a month. That is inside both free
caps.

**Kill switch:** every Google call first increments `api_usage` atomically. When the month's total
across all Google SKUs passes `GOOGLE_MONTHLY_CALL_LIMIT` (default 8,000), enrichment falls back to
the free estimator and logs `google.kill_switch`. `GOOGLE_MONTHLY_CALL_LIMIT=0` disables Google
completely.

**Caching and dedupe:**
- Geocodes are cached by normalised query in `geocode_cache`, including misses, so a re-listed
  address costs nothing.
- Commutes are computed once per (listing, destination, mode) and are unique in `commutes`.
- Only **new** listings are enriched; replays and sweeps don't re-enrich.
- Moving a destination pin doesn't re-compute anything automatically. Use "Recompute" on a
  listing if you want fresh times.

Also set a **budget alert** in Google Cloud Billing (e.g. €5). See `docs/SETUP.md`.

## Free tiers we rely on

| Service | Limit that matters | Notes |
|---|---|---|
| Vercel Hobby | 1 cron/day; 300 s max function | Scraping is triggered by Apify Schedules, not Vercel cron. Webhook `maxDuration = 120`. |
| Supabase Free | Pauses after ~7 days without activity | The scrape webhooks write every 30 min, which keeps it active. If scraping stops for a week, restore the project in the dashboard. |
| Telegram Bot API | Free | ~30 msgs/s limit, far above our volume. |
| OpenFreeMap tiles | Free, keyless | Swap via `NEXT_PUBLIC_MAP_STYLE_URL`. |
| TFI GTFS static | Free | Pre-processed at build time (`pnpm transit:refresh`). |
| NTA GTFS-R v2 | Free key | Optional live departures; cached 30 s. |
| OSM Nominatim | 1 req/s policy | Geocoding fallback **only when no Google key is set**. Disable with `DISABLE_NOMINATIM=1`. |
