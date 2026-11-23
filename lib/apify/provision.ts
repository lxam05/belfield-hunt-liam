import { ApifyClient } from "apify-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  ACTOR_ID,
  FAST_LANE_TASK_NAME,
  GROUP_ID,
  SWEEP_TASK_NAME,
  TIMEZONE,
  toSearchSettings,
} from "@/lib/config/defaults";
import { buildFastLaneInput, buildSweepInput } from "@/lib/daft/buildUrls";

/**
 * Idempotent Apify provisioning: two Actor Tasks, two Schedules (Europe/Dublin), and one
 * webhook per task (SUCCEEDED → ingest, FAILED/TIMED_OUT/ABORTED → alert).
 * Used by `pnpm setup:apify` and the Settings "Apply to Apify" button.
 */

export const WEBHOOK_EVENT_TYPES = [
  "ACTOR.RUN.SUCCEEDED",
  "ACTOR.RUN.FAILED",
  "ACTOR.RUN.TIMED_OUT",
  "ACTOR.RUN.ABORTED",
] as const;

/** Apify fills these placeholders. `resource` is the full run object (id, defaultDatasetId,
 * actorTaskId, usageTotalUsd, …); `eventData` holds actorTaskId and actorRunId. */
export const WEBHOOK_PAYLOAD_TEMPLATE = `{
  "eventType": {{eventType}},
  "createdAt": {{createdAt}},
  "eventData": {{eventData}},
  "resource": {{resource}}
}`;

export interface ProvisionOptions {
  token: string;
  appUrl: string;
  webhookSecret: string;
  db: SupabaseClient<Database>;
  log?: (msg: string) => void;
}

export interface ProvisionResult {
  fastTaskId: string;
  sweepTaskId: string;
  fastScheduleId: string;
  sweepScheduleId: string;
  webhookIds: string[];
  webhookUrl: string;
}

export function apifyClient(token: string) {
  return new ApifyClient({ token });
}

async function findByName<T extends { id: string; name?: string }>(
  list: () => Promise<{ items: T[] }>,
  name: string,
): Promise<T | undefined> {
  const { items } = await list();
  return items.find((i) => i.name === name);
}

export async function provisionApify(opts: ProvisionOptions): Promise<ProvisionResult> {
  const log = opts.log ?? (() => {});
  const client = apifyClient(opts.token);
  const { data: row, error } = await opts.db.from("settings").select("*").eq("group_id", GROUP_ID).single();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  const s = toSearchSettings(row);

  const me = await client.user("me").get();
  const username = (me as { username?: string } | undefined)?.username;
  log(`Apify user: ${username ?? "?"}`);

  const actor = await client.actor(ACTOR_ID).get();
  if (!actor) throw new Error(`Actor ${ACTOR_ID} not found`);

  // 1. Tasks
  const taskOptions = { memoryMbytes: 1024, timeoutSecs: 300 };
  const upsertTask = async (name: string, title: string, input: Record<string, unknown>) => {
    const existing = await findByName(() => client.tasks().list({ limit: 1000 }), name);
    if (existing) {
      const t = await client.task(existing.id).update({ title, input, options: taskOptions });
      log(`Updated task ${name} (${t.id})`);
      return t.id;
    }
    const t = await client.tasks().create({ actId: actor.id, name, title, input, options: taskOptions });
    log(`Created task ${name} (${t.id})`);
    return t.id;
  };
  const fastTaskId = await upsertTask(
    FAST_LANE_TASK_NAME,
    "Belfield Hunt — fast lane",
    buildFastLaneInput(s) as unknown as Record<string, unknown>,
  );
  const sweepTaskId = await upsertTask(
    SWEEP_TASK_NAME,
    "Belfield Hunt — nightly sweep",
    buildSweepInput(s) as unknown as Record<string, unknown>,
  );

  // 2. Schedules
  const upsertSchedule = async (name: string, cron: string, taskId: string) => {
    const data = {
      name,
      cronExpression: cron,
      timezone: TIMEZONE,
      // Scrapes only run when someone presses "Find rentals" (a full sweep). The schedules are
      // kept, but paused, so they can be switched back on in the Apify console if wanted.
      isEnabled: false,
      isExclusive: true, // don't start a run while the previous one is still going
      description: "Managed by Belfield Hunt (lib/apify/provision.ts)",
      actions: [{ type: "RUN_ACTOR_TASK", actorTaskId: taskId }],
    };
    const existing = await findByName(() => client.schedules().list({ limit: 1000 }), name);
    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sch = await client.schedule(existing.id).update(data as any);
      log(`Updated schedule ${name}: ${cron} (${sch.id})`);
      return sch.id;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sch = await client.schedules().create(data as any);
    log(`Created schedule ${name}: ${cron} (${sch.id})`);
    return sch.id;
  };
  const fastScheduleId = await upsertSchedule(FAST_LANE_TASK_NAME, s.fastLaneCron, fastTaskId);
  const sweepScheduleId = await upsertSchedule(SWEEP_TASK_NAME, s.sweepCron, sweepTaskId);

  // 3. Webhooks (one per task, matched by request URL path so APP_URL changes are picked up)
  const webhookUrl = `${opts.appUrl.replace(/\/$/, "")}/api/apify/webhook`;
  const headersTemplate = JSON.stringify({ "x-webhook-secret": opts.webhookSecret });
  const webhookIds: string[] = [];
  for (const [taskId, kind] of [
    [fastTaskId, "fast_lane"],
    [sweepTaskId, "nightly_sweep"],
  ] as const) {
    const { items } = await client.task(taskId).webhooks().list({ limit: 100 });
    const mine = items.filter((w) => w.requestUrl?.includes("/api/apify/webhook"));
    const data = {
      eventTypes: WEBHOOK_EVENT_TYPES,
      condition: { actorTaskId: taskId },
      requestUrl: webhookUrl,
      payloadTemplate: WEBHOOK_PAYLOAD_TEMPLATE,
      headersTemplate,
      description: `belfield-hunt:${kind}`,
      shouldInterpolateStrings: false,
      doNotRetry: false,
      isAdHoc: false,
    };
    let id: string;
    if (mine[0]) {
      id = (await client.webhook(mine[0].id).update(data)).id;
      log(`Updated webhook for ${kind} (${id})`);
      // Remove duplicates from earlier experiments.
      for (const dup of mine.slice(1)) {
        await client.webhook(dup.id).delete();
        log(`Deleted duplicate webhook ${dup.id}`);
      }
    } else {
      id = (await client.webhooks().create(data)).id;
      log(`Created webhook for ${kind} (${id})`);
    }
    webhookIds.push(id);
  }

  // 4. Persist IDs
  const { error: saveErr } = await opts.db
    .from("settings")
    .update({
      apify_fast_task_id: fastTaskId,
      apify_sweep_task_id: sweepTaskId,
      apify_fast_schedule_id: fastScheduleId,
      apify_sweep_schedule_id: sweepScheduleId,
      apify_webhook_ids: webhookIds,
      apify_provisioned_at: new Date().toISOString(),
    })
    .eq("group_id", GROUP_ID);
  if (saveErr) throw new Error(`Saving Apify IDs failed: ${saveErr.message}`);

  return { fastTaskId, sweepTaskId, fastScheduleId, sweepScheduleId, webhookIds, webhookUrl };
}

/** Start the sweep task now ("Find rentals"). The webhook handles the results. */
export async function startSweep(token: string, taskId: string, input: ReturnType<typeof buildSweepInput>) {
  const run = await apifyClient(token).task(taskId).start({ ...input }, { memory: 1024, timeout: 900 });
  return { runId: run.id, status: run.status };
}

/** Fetch every item of a dataset (clean: true), paging defensively. */
export async function fetchDatasetItems(token: string, datasetId: string, max = 2000): Promise<unknown[]> {
  const ds = apifyClient(token).dataset(datasetId);
  const out: unknown[] = [];
  const limit = 500;
  for (let offset = 0; offset < max; offset += limit) {
    const page = await ds.listItems({ clean: true, offset, limit });
    out.push(...page.items);
    if (page.items.length < limit) break;
  }
  return out;
}
