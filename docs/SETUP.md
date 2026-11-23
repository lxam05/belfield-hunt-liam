# Setup

Production runs at https://belfield-hunt-liam.vercel.app on the Vercel project `belfield-hunt-liam`.
Vercel functions run in `fra1` (see `vercel.json`).

## Environment variables

Every key the app reads is in `lib/env.ts` and `.env.example`. On Vercel they are set for Production and
Preview, and secrets use the Sensitive type, so Vercel can't show them again. `NEXT_PUBLIC_*` values are
baked in at build time, so redeploy after changing one.

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_URL` | yes | `https://belfield-hunt-liam.vercel.app`. Used in emails, Telegram links, webhooks |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase → Project Settings → API (legacy JWT keys) |
| `SITE_PASSWORD` | yes | Shared password typed on `/login` |
| `CRON_SECRET` | yes | Vercel sends it as `Authorization: Bearer …` to `/api/cron/daily` |
| `APIFY_TOKEN`, `APIFY_WEBHOOK_SECRET` | for scraping | secret ≥ 32 chars |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | for Telegram | see below |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | for push | `npx web-push generate-vapid-keys` |
| `GOOGLE_MAPS_SERVER_KEY`, `NTA_API_KEY` | optional | better geocoding / live departures |

Run the scripts below against production by loading the production values first. Exported variables
take precedence over `.env.local`:

```sh
set -a; . ./prod.env; set +a   # a file holding the production values (never commit it)
```

## Database

```sh
npx supabase link --project-ref sarnqoolceqaluaiafel
npx supabase db push --remote        # asks for the database password
```

Migrations also seed the default group, settings and destinations.

## Sign-in

No emails. `/login` asks for your name and the shared group password (`SITE_PASSWORD` on Vercel).
A name the app hasn't seen before creates a new member. Use the same name each time so your claims and
votes stay yours. Rename yourself in Settings → Members, then sign in with the new name.

`supabase/config.toml` has a `[remotes.production]` block (site URL, signup disabled). Apply it with
`npx supabase config push`. On the free tier, custom email templates are rejected, so push without the
`[auth.email.template.*]` sections. They aren't used anyway.

## Scraping (Apify)

```sh
pnpm setup:apify     # with production env loaded; creates tasks, schedules, webhooks → APP_URL
```

## Telegram

1. Create a bot with @BotFather to get `TELEGRAM_BOT_TOKEN`. Add it to the group chat, send a message,
   then read the chat id from `https://api.telegram.org/bot<token>/getUpdates` to get `TELEGRAM_CHAT_ID`.
2. Set both on Vercel and redeploy.
3. Register the webhook:

```sh
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  --data-urlencode "url=$APP_URL/api/telegram/webhook" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
```

Members send `/whoami` to the bot and paste the id into Settings → Profile.

## Vercel notes

- Deployment Protection (Vercel Authentication) covers previews only. Production must be public, or
  webhooks get a 401.
- On Hobby, Git pushes are blocked when the commit author's email isn't linked to the Vercel account. Add
  the email under Account Settings → Emails, or redeploy from the dashboard.
- Hobby crons run at most once a day. `0 8 * * *` UTC is 09:00 Irish Summer Time and 08:00 in winter.
