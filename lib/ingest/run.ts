import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GROUP_ID, MISSED_SWEEPS_THRESHOLD, toSearchSettings } from "@/lib/config/defaults";
import { normalizeItems, type NormalizedListing } from "@/lib/daft/parse";
import { fitsBudget } from "@/lib/budget";
import { apifyRunCost } from "@/lib/costs";
import { countUsage } from "@/lib/enrich/usage";
import { log } from "@/lib/log";

type Db = SupabaseClient<Database>;
export type RunKind = "fast_lane" | "nightly_sweep" | "manual" | "replay" | "unknown";

export interface IngestInput {
  db: Db;
  runId: string;
  datasetId: string;
  taskId?: string | null;
  eventType?: string;
  kind?: RunKind;
  /** Reported by Apify on the run object, if present. */
  usageTotalUsd?: number | null;
  fetchItems: (datasetId: string) => Promise<unknown[]>;
  now?: Date;
}

export interface IngestResult {
  status: "duplicate" | "ok";
  runId: string;
  kind: RunKind;
  items: number;
  newIds: number[];
  updatedIds: number[];
  /** New listings plus previously-seen ones that never finished enrichment. */
  toEnrich: number[];
  goneMarked: number;
  invalid: number;
}

/** Atomically take ownership of a run id. Returns false if it was already processed. */
async function claimRun(db: Db, runId: string, kind: RunKind, taskId: string | null, datasetId: string, eventType?: string) {
  const { data: inserted } = await db
    .from("scrape_runs")
    .upsert(
      { apify_run_id: runId, kind, task_id: taskId, dataset_id: datasetId, event_type: eventType ?? null, status: "processing" },
      { onConflict: "apify_run_id", ignoreDuplicates: true },
    )
    .select("apify_run_id");
  if (inserted && inserted.length > 0) return { ok: true, kind };
  // Row exists: only "received" (pre-registered by Scrape now) or "failed" (retry) may proceed.
  const { data: taken } = await db
    .from("scrape_runs")
    .update({ status: "processing", dataset_id: datasetId, event_type: eventType ?? null, task_id: taskId, error: null })
    .eq("apify_run_id", runId)
    .in("status", ["received", "failed"])
    .select("kind");
  if (taken && taken.length > 0) return { ok: true, kind: (taken[0].kind as RunKind) ?? kind };
  return { ok: false, kind };
}

export async function resolveKind(db: Db, taskId: string | null | undefined): Promise<RunKind> {
  if (!taskId) return "unknown";
  const { data } = await db.from("settings").select("apify_fast_task_id, apify_sweep_task_id").eq("group_id", GROUP_ID).single();
  if (data?.apify_fast_task_id === taskId) return "fast_lane";
  if (data?.apify_sweep_task_id === taskId) return "nightly_sweep";
  return "unknown";
}

function toRow(n: NormalizedListing, nowIso: string, sweep: boolean) {
  return {
    ...n,
    raw: n.raw as Database["public"]["Tables"]["listings"]["Insert"]["raw"],
    last_seen_at: nowIso,
    missed_sweeps: 0,
    status: "active" as const,
    ...(sweep ? { last_swept_at: nowIso } : {}),
  };
}

export async function ingestRun(input: IngestInput): Promise<IngestResult> {
  const { db, runId, datasetId } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const kind0 = input.kind ?? (await resolveKind(db, input.taskId));
  const claim = await claimRun(db, runId, kind0, input.taskId ?? null, datasetId, input.eventType);
  const kind = claim.kind;
  const empty: IngestResult = { status: "duplicate", runId, kind, items: 0, newIds: [], updatedIds: [], toEnrich: [], goneMarked: 0, invalid: 0 };
  if (!claim.ok) return empty;

  try {
    const items = await input.fetchItems(datasetId);
    const { listings, errors } = normalizeItems(items);
    if (errors.length) log.warn("ingest.invalid_items", { runId, count: errors.length, first: errors[0] });
    const ids = listings.map((l) => l.id);

    const existing = new Map<number, { id: number; enriched_at: string | null }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("listings").select("id, enriched_at").in("id", ids.slice(i, i + 200));
      for (const r of data ?? []) existing.set(r.id, r);
    }
    const newIds = ids.filter((id) => !existing.has(id));
    const updatedIds = ids.filter((id) => existing.has(id));
    const sweep = kind === "nightly_sweep";

    // Upsert. first_seen_at is omitted so it keeps its insert-time default.
    const rows = listings.map((l) => toRow(l, nowIso, sweep));
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from("listings").upsert(rows.slice(i, i + 100), { onConflict: "id" });
      if (error) throw new Error(`listings upsert: ${error.message}`);
    }

    // Sweep: count misses for active listings the sweep should have returned but didn't.
    let goneMarked = 0;
    if (sweep) goneMarked = await markMissedSweeps(db, new Set(ids), items.length, nowIso);

    const toEnrich = [...newIds, ...updatedIds.filter((id) => !existing.get(id)?.enriched_at)];
    const cost = input.usageTotalUsd ?? apifyRunCost(items.length, kind);
    await db
      .from("scrape_runs")
      .update({
        status: "succeeded",
        items: items.length,
        new_items: newIds.length,
        updated_items: updatedIds.length,
        cost_usd: Math.round(cost * 100000) / 100000,
        finished_at: new Date().toISOString(),
      })
      .eq("apify_run_id", runId);
    await countUsage(db, "apify", "results", items.length);
    await countUsage(db, "apify", "runs", 1);
    await countUsage(db, "apify", "usd_micros", Math.round(cost * 1_000_000));

    log.info("ingest.done", { runId, kind, items: items.length, new: newIds.length, goneMarked });
    return { status: "ok", runId, kind, items: items.length, newIds, updatedIds, toEnrich, goneMarked, invalid: errors.length };
  } catch (e) {
    await db
      .from("scrape_runs")
      .update({ status: "failed", error: (e as Error).message.slice(0, 1000), finished_at: new Date().toISOString() })
      .eq("apify_run_id", runId);
    throw e;
  }
}

async function markMissedSweeps(db: Db, seen: Set<number>, itemCount: number, nowIso: string): Promise<number> {
  const { data: settingsRow } = await db.from("settings").select("*").eq("group_id", GROUP_ID).single();
  const s = toSearchSettings(settingsRow);
  if (itemCount >= s.sweepResultsWanted) {
    // The sweep hit its cap, so absence proves nothing. Don't punish unseen listings.
    await db.from("events").insert({ kind: "sweep.truncated", level: "warn", message: `Search reached its ${itemCount}-listing limit. More listings may be available.` });
    log.warn("sweep.truncated", { itemCount, cap: s.sweepResultsWanted });
    return 0;
  }
  const { data: active } = await db
    .from("listings")
    .select("id, monthly_rent, beds, beds_min, beds_max, missed_sweeps, status")
    .in("status", ["active", "possibly_gone"]);
  let marked = 0;
  for (const l of active ?? []) {
    if (seen.has(l.id)) continue;
    // Only listings the sweep's filters would match: in bedroom range and within the total cap.
    const beds = l.beds ?? l.beds_min;
    const inRange = beds != null && beds >= s.bedsMin && beds <= s.bedsMax;
    if (!inRange || !fitsBudget(l, s.maxPerPerson)) continue;
    const missed = l.missed_sweeps + 1;
    const status = missed >= MISSED_SWEEPS_THRESHOLD ? "possibly_gone" : l.status;
    if (status === "possibly_gone" && l.status !== "possibly_gone") marked++;
    await db.from("listings").update({ missed_sweeps: missed, status, last_swept_at: nowIso }).eq("id", l.id);
  }
  return marked;
}
