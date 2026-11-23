# Decisions

Short log of choices made while building, with the reason for each.

## Scaffold

- **Next.js 16.4 with Cache Components on** (the create-next-app default). Pages are thin
  server shells; authenticated data is loaded client-side through Supabase (RLS) and kept live
  with Realtime. This keeps every page's static shell instant and offline-cacheable for the PWA,
  and avoids reading cookies outside `<Suspense>` (a build error with Cache Components).
- **Auth gate in `proxy.ts`** (Next 16's renamed middleware) refreshes the Supabase session cookie
  and redirects anonymous users to `/login`. API routes re-check the user themselves.
- **shadcn/ui `base-nova` style** (Base UI primitives, the current shadcn default) instead of Radix.
- **pnpm 12**; build scripts allow-listed in `pnpm-workspace.yaml` (esbuild, sharp, supabase CLI).

## Apify & ingestion

- **One webhook per task** with `ACTOR.RUN.SUCCEEDED/FAILED/TIMED_OUT/ABORTED`. The payload sends
  the full `{{resource}}` run object plus `{{eventData}}` (so we get `id`, `defaultDatasetId`,
  `actorTaskId` and `usageTotalUsd`). The secret is in `headersTemplate` as `x-webhook-secret` and
  checked in constant time. Provisioning matches existing tasks and schedules by name and
  webhooks by request path, so re-running it never creates duplicates.
- **Schedules are `isExclusive`**: a slow run never overlaps the next one.
- **Idempotency on the Apify run id**: `scrape_runs` gets an insert-or-ignore. Only rows in
  `received` (pre-registered by "Scrape now") or `failed` (we returned 500, so Apify retries) can
  be re-taken. Listings upsert on the Daft id. Notifications have a permanent
  `(listing_id, channel)` primary key, so neither replays nor retries ever re-notify.
- **Webhook returns fast**: the dataset upsert is synchronous (sub-second for 10 items). Geocoding,
  Routes, scoring and Telegram run in `after()` under the route's `maxDuration = 120`.
- **Sweep gone-detection** only counts a miss for active listings that the sweep's filters would
  actually have matched (bedroom range + per-person budget). It skips the whole check when the
  sweep hit its `results_wanted` cap, because then a missing listing proves nothing.
- **Developments** ("1, 2 & 3 bed", "From €X") use the smallest unit for the per-person rule,
  because the "From" price refers to that unit.
- `runtime = "nodejs"` is not exported from routes: Cache Components forbids the option, and
  Node.js is the default runtime anyway.
- Scripts run under `tsx --conditions=react-server`, so `import "server-only"` resolves to its
  no-op build and scripts reuse exactly the same modules as the API routes.

## Enrichment

- **Geocoding order:** trailing Eircode, then `"<title>, Ireland"` (Google with
  `components=country:IE` and Dublin bounds), then the suburb/postcode centroid
  (precision `area`). Results outside a Dublin bbox are rejected. With no Google key, OSM
  Nominatim is the free fallback.
- **Routes:** fixed future times (next weekday 08:30 out, 18:00 back) keep calls on the
  Essentials SKU, because "now" means traffic-aware pricing. The 18:00 return trip is on, since
  volume stays well under the free cap (see COSTS.md).
- **Estimator** (no key or kill switch): road distance = straight line × 1.3; bike 16 km/h + 2 min;
  walk 4.8 km/h; transit = walk to nearest stop + 6 min wait + ride at 15 km/h (bus) or
  22 km/h (Luas when both ends are within 900 m of a Luas stop). Estimates are stored with
  `source = 'estimate'` and shown with a "~" prefix.
- **GTFS** is processed at build time with streaming unzip (fflate) in three passes, so the
  ~150 MB feed and its very large `stop_times.txt` never load into memory at once. "Serves a
  destination" means the route stops within 400 m of the destination pin.

## UI

- **All group data lives in a client store** (`lib/store`): one RLS-scoped load of the last 60
  days (a few hundred rows), kept live with one Supabase Realtime channel, and snapshotted to
  localStorage for the offline PWA view. Scores are recomputed client-side, so votes and weight
  changes re-rank instantly for everyone.
- **Claims are optimistic** but the DB decides: `claim_listing()` returns the real winner. If it
  isn't you, the UI rolls back and says who won.
- **MapLibre worker:** v6 loads its worker relative to its own module URL, which breaks once
  Turbopack bundles it. `scripts/copy-maplibre-worker.mjs` (pre-build/pre-dev) copies the
  worker to `public/maplibre/` and the map calls `setWorkerUrl()`. MapLibre's CSS sets
  `.maplibregl-map { position: relative }`, so the container is sized with `h-full w-full`, not
  `absolute inset-0`. Label layers use OpenFreeMap's "Noto Sans" glyphs.
- **Native `<select>` and checkboxes** in filters: faster and better on phones than custom popovers.
- **Shared-password entry, no email.** `/login` takes a name and the group password
  (`SITE_PASSWORD`). The server action matches the name to a member (case-insensitive) or creates one
  (everyone is admin), makes a Supabase auth user with a synthetic `@members.belfield-hunt.local`
  address, and signs in server-side with `generateLink` + `verifyOtp`. Supabase Auth stays underneath
  so RLS, Realtime and per-member claims/votes are unchanged. Trade-off: anyone with the password
  can enter as any name.
