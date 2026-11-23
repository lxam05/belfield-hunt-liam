/**
 * pnpm ingest:dataset <datasetId>        — replay an Apify dataset through the pipeline
 * pnpm ingest:dataset --file items.json  — same, from a local JSON array (no Apify needed)
 *   --no-notify   skip Telegram/push     --kind nightly_sweep   treat as a sweep
 *
 * Safe to repeat: listings upsert on id and notifications are once per listing.
 */
import { readFileSync } from "node:fs";
import { ingestRun, type RunKind } from "@/lib/ingest/run";
import { enrichListings } from "@/lib/enrich";
import { fetchDatasetItems } from "@/lib/apify/provision";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enrichDeps } from "@/lib/ingest/handle";
import { env } from "@/lib/env";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args.splice(i, 2)[1] ?? "") : undefined;
  };
  const file = flag("--file");
  const kind = (flag("--kind") as RunKind | undefined) ?? "replay";
  const noNotify = args.includes("--no-notify");
  const datasetId = file ? `file:${file}` : args.find((a) => !a.startsWith("--"));
  if (!datasetId) {
    console.error("Usage: pnpm ingest:dataset <datasetId> | --file items.json [--kind nightly_sweep] [--no-notify]");
    process.exit(2);
  }
  const fetchItems = async (id: string) => {
    if (file) return JSON.parse(readFileSync(file, "utf8")) as unknown[];
    const token = env().APIFY_TOKEN;
    if (!token) throw new Error("APIFY_TOKEN is not set");
    return fetchDatasetItems(token, id);
  };
  const runId = `replay:${datasetId}:${Date.now()}`;
  const result = await ingestRun({ db: supabaseAdmin(), runId, datasetId, kind, fetchItems });
  console.log(`Ingested ${result.items} items: ${result.newIds.length} new, ${result.updatedIds.length} updated, ${result.invalid} invalid, ${result.goneMarked} marked possibly_gone.`);
  const summary = await enrichListings(result.toEnrich, { ...enrichDeps(), notify: !noNotify });
  console.log(`Enriched ${summary.enriched}, notified ${summary.notified}, Google calls ${summary.googleCalls}, estimates ${summary.estimates}, errors ${summary.errors}.`);
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
