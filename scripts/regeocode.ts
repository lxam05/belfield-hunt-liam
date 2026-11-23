/**
 * pnpm regeocode [--all]
 * Re-geocode listings whose location is only approximate (precision 'area'/'fallback'), or all
 * listings with --all, then recompute their commutes and scores. Never re-notifies.
 * Uses Google if GOOGLE_MAPS_SERVER_KEY is set (counts against the monthly limit), else Nominatim.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enrichListings } from "@/lib/enrich";
import { enrichDeps } from "@/lib/ingest/handle";

async function main() {
  const db = supabaseAdmin();
  let q = db.from("listings").select("id, title, geocode_precision").neq("status", "gone");
  if (!process.argv.includes("--all")) q = q.in("geocode_precision", ["area", "fallback"]);
  const { data: rows, error } = await q;
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.id);
  console.log(`Re-geocoding ${ids.length} listings…`);
  if (!ids.length) return;
  // Forget cached misses so the new query variants get a chance.
  await db.from("geocode_cache").delete().is("lat", null);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await db.from("commutes").delete().in("listing_id", chunk);
    await db.from("listings").update({ lat: null, lng: null, geocode_precision: null, enriched_at: null }).in("id", chunk);
  }
  const s = await enrichListings(ids, { ...enrichDeps(), notify: false });
  const { data: after } = await db.from("listings").select("geocode_precision").in("id", ids);
  const counts: Record<string, number> = {};
  for (const r of after ?? []) counts[r.geocode_precision ?? "null"] = (counts[r.geocode_precision ?? "null"] ?? 0) + 1;
  console.log(`Done: enriched ${s.enriched}, Google calls ${s.googleCalls}, errors ${s.errors}. Precision now:`, counts);
}

main().catch((e) => {
  console.error("✖", e instanceof Error ? e.message : e);
  process.exit(1);
});
