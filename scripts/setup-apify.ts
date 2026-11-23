/**
 * pnpm setup:apify — idempotently create/update the Apify tasks, schedules and webhooks.
 * Needs APIFY_TOKEN, APIFY_WEBHOOK_SECRET, APP_URL (production URL!), Supabase service role.
 */
import { provisionApify } from "@/lib/apify/provision";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

async function main() {
  const e = env();
  if (!e.APIFY_TOKEN) throw new Error("APIFY_TOKEN is not set");
  if (!e.APIFY_WEBHOOK_SECRET || e.APIFY_WEBHOOK_SECRET.length < 32) {
    throw new Error("APIFY_WEBHOOK_SECRET must be set (32+ random chars)");
  }
  if (/localhost|127\.0\.0\.1/.test(e.APP_URL)) {
    console.warn(`⚠ APP_URL is ${e.APP_URL}: Apify cannot reach localhost. Use your production URL or a tunnel.`);
  }
  const r = await provisionApify({
    token: e.APIFY_TOKEN,
    appUrl: e.APP_URL,
    webhookSecret: e.APIFY_WEBHOOK_SECRET,
    db: supabaseAdmin(),
    log: (m) => console.log("•", m),
  });
  console.log("\nApify provisioned and IDs saved to the settings table:");
  console.table({
    "fast-lane task": r.fastTaskId,
    "sweep task": r.sweepTaskId,
    "fast-lane schedule": r.fastScheduleId,
    "sweep schedule": r.sweepScheduleId,
    webhooks: r.webhookIds.join(", "),
    "webhook URL": r.webhookUrl,
  });
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
