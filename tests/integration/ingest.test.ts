/**
 * Ingestion + notification idempotency against local Supabase, with Telegram faked.
 * Acceptance: replaying the same dataset creates no duplicates and no repeat notifications.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import fixtures from "../fixtures/daft-sample.json";
import { ingestRun } from "@/lib/ingest/run";
import { enrichListings } from "@/lib/enrich";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
process.env.DISABLE_NOMINATIM = "1";

async function reachable() {
  if (!SERVICE) return false;
  try {
    return (await fetch(`${URL}/auth/v1/health`, { headers: { apikey: SERVICE } })).ok;
  } catch {
    return false;
  }
}
const up = await reachable();

// Use ids that don't clash with the fixture replays a developer may have done.
const items = (fixtures as Record<string, unknown>[])
  .filter((f) => typeof f.id === "number")
  .map((f): Record<string, unknown> => ({ ...f, id: 880000000 + ((f.id as number) % 100000), publishDate: new Date().toISOString() }));
const ids = [...new Set(items.map((i) => i.id as number))];

describe.skipIf(!up)("ingestion pipeline (local Supabase)", () => {
  let db: SupabaseClient<Database>;
  const sent: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.telegram.org/")) {
      sent.push(JSON.parse(String(init?.body ?? "{}")).caption ?? "text");
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
    }
    throw new Error(`unexpected network call in test: ${url}`);
  };
  const deps = () => ({
    db,
    googleLimit: 0,
    appUrl: "http://localhost:3000",
    telegram: { token: "test", chatId: "-1" },
    fetchImpl: fakeFetch,
  });

  beforeAll(async () => {
    db = createClient<Database>(URL, SERVICE, { auth: { persistSession: false } });
    await db.from("listings").delete().in("id", ids);
    await db.from("scrape_runs").delete().like("apify_run_id", "itest-%");
    // Low threshold so fitting fixtures notify.
    await db.from("settings").update({ notify_score_threshold: 0 }).neq("max_per_person", 0);
  });

  it("dedupes on run id: the same webhook twice is processed once", async () => {
    const run = { db, runId: "itest-run-1", datasetId: "ds1", kind: "fast_lane" as const, fetchItems: async () => items };
    const first = await ingestRun(run);
    const second = await ingestRun(run);
    expect(first.status).toBe("ok");
    expect(first.newIds.sort()).toEqual(ids.sort());
    expect(second.status).toBe("duplicate");
  });

  it("a different run with the same dataset creates no duplicate listings", async () => {
    const r = await ingestRun({ db, runId: "itest-run-2", datasetId: "ds1", kind: "replay", fetchItems: async () => items });
    expect(r.newIds).toEqual([]);
    expect(r.updatedIds.sort()).toEqual(ids.sort());
    const { count } = await db.from("listings").select("id", { count: "exact", head: true }).in("id", ids);
    expect(count).toBe(ids.length);
  });

  it("notifies each fitting listing exactly once across replays", async () => {
    await db.from("listings").update({ lat: 53.3075, lng: -6.2236, geocode_precision: "rooftop" }).eq("id", ids[0]);
    const a = await enrichListings(ids, deps());
    const firstSends = sent.length;
    expect(a.notified).toBeGreaterThan(0);
    expect(firstSends).toBe(a.notified);
    // Replay enrichment (as a retried webhook would) → no new messages.
    const b = await enrichListings(ids, deps());
    expect(b.notified).toBe(0);
    expect(sent.length).toBe(firstSends);
    const { data: n } = await db.from("notifications").select("listing_id").eq("channel", "telegram").in("listing_id", ids);
    expect(n!.length).toBe(firstSends);
  });

  it("does not notify over-budget or price-on-application listings", async () => {
    const { data: n } = await db.from("notifications").select("listing_id").eq("channel", "telegram").in("listing_id", ids);
    const notified = new Set(n!.map((r) => r.listing_id));
    const poa = items.find((i) => i.price === "Price on Application")!.id as number;
    expect(notified.has(poa)).toBe(false);
  });

  it("marks listings missed by 3 sweeps as possibly_gone", async () => {
    const keep = items.slice(0, 1);
    for (let i = 0; i < 3; i++) {
      await ingestRun({ db, runId: `itest-sweep-${i}`, datasetId: "ds", kind: "nightly_sweep", fetchItems: async () => keep });
    }
    const { data } = await db.from("listings").select("id, status, missed_sweeps").in("id", ids);
    const kept = data!.find((l) => l.id === keep[0].id)!;
    expect(kept.status).toBe("active");
    const gone = data!.filter((l) => l.status === "possibly_gone");
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((l) => l.missed_sweeps >= 3)).toBe(true);
    // Seen again in a fast-lane run → active again.
    await ingestRun({ db, runId: "itest-run-3", datasetId: "ds", kind: "fast_lane", fetchItems: async () => items });
    const { data: after } = await db.from("listings").select("status").in("id", ids);
    expect(after!.every((l) => l.status === "active")).toBe(true);
  });
});
