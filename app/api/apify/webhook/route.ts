import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/ingest/secure";
import { ApifyWebhookSchema } from "@/lib/ingest/payload";
import { handleFailedRun, ingestFromApify, recordEvent } from "@/lib/ingest/handle";
import { kickPendingEnrichment } from "@/lib/enrich/pending";
import { log } from "@/lib/log";

export const maxDuration = 120;

/**
 * Apify → us. Verifies the shared secret (constant time), dedupes on the run id, upserts the
 * dataset synchronously (a few hundred ms), then enriches + notifies in after() so Apify gets
 * its 200 quickly and doesn't retry.
 */
export async function POST(req: NextRequest) {
  const secret = env().APIFY_WEBHOOK_SECRET;
  if (!secret || !safeEqual(req.headers.get("x-webhook-secret"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = ApifyWebhookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad payload" }, { status: 400 });
  const p = parsed.data;

  await recordEvent("apify.webhook", "info", `${p.eventType} ${p.resource.id}`);

  if (p.eventType !== "ACTOR.RUN.SUCCEEDED") {
    await handleFailedRun(p);
    return NextResponse.json({ ok: true, handled: "failure" });
  }
  if (!p.resource.defaultDatasetId) return NextResponse.json({ error: "no dataset" }, { status: 400 });

  try {
    const result = await ingestFromApify({
      runId: p.resource.id,
      datasetId: p.resource.defaultDatasetId,
      taskId: p.resource.actorTaskId ?? p.eventData?.actorTaskId ?? null,
      eventType: p.eventType,
      usageTotalUsd: p.resource.usageTotalUsd ?? null,
    });
    if (result.status === "duplicate") return NextResponse.json({ ok: true, duplicate: true });
    if (result.toEnrich.length > 0) {
      // A big search can't be enriched within this call's time limit, so a separate route
      // works through the backlog in chained calls.
      after(() => kickPendingEnrichment());
    }
    return NextResponse.json({ ok: true, items: result.items, new: result.newIds.length, enriching: result.toEnrich.length });
  } catch (e) {
    log.error("webhook.ingest_failed", { runId: p.resource.id, error: e as Error });
    await recordEvent("apify.ingest_failed", "error", (e as Error).message, { runId: p.resource.id });
    // 500 → Apify retries; the run row is marked failed so the retry may reprocess it.
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
