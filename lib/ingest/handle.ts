import "server-only";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchDatasetItems } from "@/lib/apify/provision";
import { enrichListings, type EnrichSummary } from "@/lib/enrich";
import { sendText } from "@/lib/notify/telegram";
import { escapeHtml } from "@/lib/notify/format";
import { ingestRun, resolveKind, type IngestResult, type RunKind } from "./run";
import type { ApifyWebhook } from "./payload";
import { log } from "@/lib/log";

export function enrichDeps() {
  const e = env();
  return {
    db: supabaseAdmin(),
    googleKey: e.GOOGLE_MAPS_SERVER_KEY,
    googleLimit: e.GOOGLE_MONTHLY_CALL_LIMIT,
    appUrl: e.APP_URL,
    telegram: e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID ? { token: e.TELEGRAM_BOT_TOKEN, chatId: e.TELEGRAM_CHAT_ID } : undefined,
    returnTrip: true,
  };
}

export async function recordEvent(kind: string, level: "info" | "warn" | "error", message: string, data: Record<string, unknown> = {}) {
  try {
    await supabaseAdmin().from("events").insert({ kind, level, message, data: data as never });
  } catch {
    /* logging must never break ingestion */
  }
}

/** Record an Apify FAILED/TIMED_OUT/ABORTED run and alert the group chat. */
export async function handleFailedRun(p: ApifyWebhook) {
  const db = supabaseAdmin();
  const taskId = p.resource.actorTaskId ?? p.eventData?.actorTaskId ?? null;
  const kind = await resolveKind(db, taskId);
  await db.from("scrape_runs").upsert({
    apify_run_id: p.resource.id,
    kind,
    task_id: taskId,
    dataset_id: p.resource.defaultDatasetId ?? null,
    event_type: p.eventType,
    status: "apify_failed",
    error: p.resource.statusMessage ?? p.eventType,
    finished_at: new Date().toISOString(),
  });
  await recordEvent("apify.run_failed", "error", `${kind} run ${p.resource.id}: ${p.eventType}`, { status: p.resource.status });
  const deps = enrichDeps();
  if (deps.telegram) {
    await sendText(
      deps.telegram,
      `⚠️ Apify ${escapeHtml(kind)} run <code>${escapeHtml(p.resource.id)}</code> ended with <b>${escapeHtml(p.eventType)}</b>.\n${escapeHtml(p.resource.statusMessage ?? "")}\nCheck Apify credits / console.`,
    ).catch((e) => log.warn("telegram.alert_failed", { error: e as Error }));
  }
}

/** Ingest a run's dataset (fast, synchronous part). */
export async function ingestFromApify(args: {
  runId: string;
  datasetId: string;
  taskId?: string | null;
  eventType?: string;
  kind?: RunKind;
  usageTotalUsd?: number | null;
}): Promise<IngestResult> {
  const e = env();
  if (!e.APIFY_TOKEN) throw new Error("APIFY_TOKEN is not set");
  const token = e.APIFY_TOKEN;
  return ingestRun({ db: supabaseAdmin(), ...args, fetchItems: (id) => fetchDatasetItems(token, id) });
}

/** Slow part: geocode, commutes, score, notify. Runs in after() from the webhook. */
export async function enrichAfterIngest(result: IngestResult): Promise<EnrichSummary> {
  const summary = await enrichListings(result.toEnrich, enrichDeps());
  await supabaseAdmin().from("scrape_runs").update({ notified: summary.notified }).eq("apify_run_id", result.runId);
  if (summary.errors) await recordEvent("enrich.errors", "warn", `${summary.errors} enrichment errors in run ${result.runId}`);
  log.info("enrich.done", { runId: result.runId, ...summary });
  return summary;
}
