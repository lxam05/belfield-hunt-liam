import { enrichListings } from "@/lib/enrich";
import { env } from "@/lib/env";
import { enrichDeps } from "@/lib/ingest/handle";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

/**
 * Enrich (locate, commutes, score) listings that were ingested but not yet enriched, newest
 * first, until the time budget runs out. A 300-listing search needs several minutes because the
 * free geocoder allows about one lookup per second, which is longer than one function call gets.
 */
export async function enrichPending(budgetMs: number): Promise<{ enriched: number; remaining: number }> {
  const deadline = Date.now() + budgetMs;
  const db = supabaseAdmin();
  const { data: rows, error } = await db
    .from("listings")
    .select("id")
    .is("enriched_at", null)
    .neq("status", "gone")
    .order("first_seen_at", { ascending: false });
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.id);
  let enriched = 0;
  let done = 0;
  const deps = enrichDeps();
  while (done < ids.length && Date.now() < deadline) {
    const chunk = ids.slice(done, done + 5);
    const s = await enrichListings(chunk, deps);
    enriched += s.enriched;
    done += chunk.length;
  }
  return { enriched, remaining: ids.length - done };
}

/**
 * Ask our own /api/enrich/pending route to start (or continue) working through the backlog in
 * a fresh function call. Only waits long enough for the request to be sent.
 */
export async function kickPendingEnrichment(): Promise<void> {
  const e = env();
  if (!e.CRON_SECRET || /localhost|127\.0\.0\.1/.test(e.APP_URL)) return;
  try {
    await fetch(`${e.APP_URL.replace(/\/$/, "")}/api/enrich/pending`, {
      method: "POST",
      headers: { authorization: `Bearer ${e.CRON_SECRET}` },
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    // A timeout is expected: the other call keeps running after we stop waiting.
    if ((err as Error).name !== "TimeoutError") log.error("enrich.kick_failed", { error: err as Error });
  }
}
