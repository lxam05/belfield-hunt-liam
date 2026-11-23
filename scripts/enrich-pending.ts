/**
 * pnpm enrich:pending
 * Finish enrichment (location, commutes, score) for listings that were ingested but never
 * enriched, e.g. when a big search ran out of server time. Never re-notifies.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enrichListings } from "@/lib/enrich";
import { enrichDeps } from "@/lib/ingest/handle";

async function main() {
  const db = supabaseAdmin();
  const { data: rows, error } = await db
    .from("listings")
    .select("id")
    .is("enriched_at", null)
    .neq("status", "gone");
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.id);
  console.log(`Enriching ${ids.length} listings…`);
  for (let i = 0; i < ids.length; i += 20) {
    const s = await enrichListings(ids.slice(i, i + 20), { ...enrichDeps(), notify: false });
    console.log(`  ${Math.min(i + 20, ids.length)}/${ids.length} (errors ${s.errors})`);
  }
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
