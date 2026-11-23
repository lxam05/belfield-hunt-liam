/**
 * pnpm scrape:local [sweep|fast] [--no-notify]
 *
 * Runs the Daft Actor directly with APIFY_TOKEN (no tasks/schedules/webhook needed), waits for
 * it, then pushes the dataset through the real ingestion + enrichment pipeline. Use it for local
 * testing, where Apify can't reach your webhook on localhost.
 *   sweep (default): the nightly-sweep input, 4 URLs, up to 300 results (≈ $0.30)
 *   fast:            the fast-lane input, 10 newest (≈ $0.012)
 */
import { apifyClient, fetchDatasetItems } from "@/lib/apify/provision";
import { ACTOR_ID, GROUP_ID, toSearchSettings } from "@/lib/config/defaults";
import { buildFastLaneInput, buildSweepInput } from "@/lib/daft/buildUrls";
import { ingestRun } from "@/lib/ingest/run";
import { enrichListings } from "@/lib/enrich";
import { enrichDeps } from "@/lib/ingest/handle";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

async function main() {
  const mode = process.argv.includes("fast") ? "fast" : "sweep";
  const noNotify = process.argv.includes("--no-notify");
  const token = env().APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set in .env.local");

  const db = supabaseAdmin();
  const { data: row } = await db.from("settings").select("*").eq("group_id", GROUP_ID).single();
  const s = toSearchSettings(row);
  const input = mode === "fast" ? buildFastLaneInput(s) : buildSweepInput(s);

  console.log(`Starting ${mode} run of ${ACTOR_ID} (${input.propertyUrls.length} URL(s), up to ${input.results_wanted} results)…`);
  const run = await apifyClient(token)
    .actor(ACTOR_ID)
    .call(input as unknown as Record<string, unknown>, { memory: 1024, timeout: 300, maxTotalChargeUsd: mode === "fast" ? 0.05 : 0.6 });
  console.log(`Run ${run.id} ${run.status} · dataset ${run.defaultDatasetId}${run.usageTotalUsd != null ? ` · $${run.usageTotalUsd.toFixed(4)}` : ""}`);
  if (run.status !== "SUCCEEDED") throw new Error(`Run ended with ${run.status}: ${run.statusMessage ?? ""}`);

  const result = await ingestRun({
    db,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    kind: mode === "fast" ? "manual" : "nightly_sweep",
    usageTotalUsd: run.usageTotalUsd ?? null,
    fetchItems: (id) => fetchDatasetItems(token, id),
  });
  console.log(`Ingested ${result.items} items: ${result.newIds.length} new, ${result.updatedIds.length} updated, ${result.invalid} invalid.`);
  console.log(`Enriching ${result.toEnrich.length} listings (geocode → commutes → score${noNotify ? "" : " → notify"})…`);
  const summary = await enrichListings(result.toEnrich, { ...enrichDeps(), notify: !noNotify });
  console.log(`Done: enriched ${summary.enriched}, notified ${summary.notified}, Google calls ${summary.googleCalls}, estimates ${summary.estimates}, errors ${summary.errors}.`);
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
