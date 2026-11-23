import { after, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireMember } from "@/lib/auth/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { apifyClient, fetchDatasetItems, startSweep } from "@/lib/apify/provision";
import { ACTOR_ID, GROUP_ID, toSearchSettings } from "@/lib/config/defaults";
import { buildSweepInput } from "@/lib/daft/buildUrls";
import { ingestRun } from "@/lib/ingest/run";
import { enrichAfterIngest, recordEvent } from "@/lib/ingest/handle";
import { log } from "@/lib/log";

export const maxDuration = 120;

/**
 * "Find rentals": start a full sweep now. This is the only way scrapes run; the Apify schedules
 * are paused.
 * - Deployed + provisioned: start the Apify sweep task; results arrive through the webhook.
 * - Local dev (APP_URL is localhost) or not provisioned yet: Apify can't call us back, so run
 *   the Actor directly, wait and ingest in this request; enrichment runs in after().
 */
export async function POST() {
  const me = await requireMember();
  if (me instanceof NextResponse) return me;
  const e = env();
  if (!e.APIFY_TOKEN) {
    return NextResponse.json({ error: "APIFY_TOKEN is not set on the server (add it to .env.local / Vercel env and restart)" }, { status: 503 });
  }
  const db = supabaseAdmin();

  const { data: s } = await db.from("settings").select("*").eq("group_id", GROUP_ID).single();

  // Rate-limit: at most one sweep per 10 minutes (each sweep costs ~$0.25).
  const since = new Date(Date.now() - 600_000).toISOString();
  const { count } = await db
    .from("scrape_runs")
    .select("apify_run_id", { count: "exact", head: true })
    .eq("kind", "nightly_sweep")
    .gte("received_at", since);
  if ((count ?? 0) > 0) return NextResponse.json({ error: "A search was started less than 10 minutes ago" }, { status: 429 });
  const local = /localhost|127\.0\.0\.1/.test(e.APP_URL);

  if (s?.apify_sweep_task_id && !local) {
    const run = await startSweep(e.APIFY_TOKEN, s.apify_sweep_task_id, buildSweepInput(toSearchSettings(s)));
    // Registered as a sweep so ingest also marks listings that have disappeared from Daft.
    await db.from("scrape_runs").upsert({ apify_run_id: run.runId, kind: "nightly_sweep", task_id: s.apify_sweep_task_id, status: "received" });
    await recordEvent("apify.scrape_now", "info", `${me.displayName} started run ${run.runId}`);
    return NextResponse.json({ ok: true, runId: run.runId, mode: "webhook" });
  }

  // Direct mode.
  const token = e.APIFY_TOKEN;
  const run = await apifyClient(token)
    .actor(ACTOR_ID)
    .call(buildSweepInput(toSearchSettings(s)) as unknown as Record<string, unknown>, {
      memory: 1024,
      timeout: 110,
      waitSecs: 110,
      maxTotalChargeUsd: 0.5,
    });
  if (run.status !== "SUCCEEDED") {
    return NextResponse.json({ error: `Apify run ${run.id} ended with ${run.status}` }, { status: 502 });
  }
  const result = await ingestRun({
    db,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    kind: "nightly_sweep",
    usageTotalUsd: run.usageTotalUsd ?? null,
    fetchItems: (id) => fetchDatasetItems(token, id),
  });
  await recordEvent("apify.scrape_now", "info", `${me.displayName} ran ${run.id} directly (${result.items} items, ${result.newIds.length} new)`);
  if (result.toEnrich.length) {
    after(() => enrichAfterIngest(result).catch((err) => log.error("enrich.after_failed", { error: err as Error })));
  }
  return NextResponse.json({ ok: true, runId: run.id, mode: "direct", items: result.items, new: result.newIds.length });
}
