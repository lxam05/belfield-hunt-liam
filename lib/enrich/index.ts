import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GROUP_ID, toSearchSettings, type ScoreWeights } from "@/lib/config/defaults";
import { assessRental, campusPoint } from "@/lib/rental-search";
import { haversineM } from "@/lib/geo";
import { scoreListing } from "@/lib/scoring";
import { nextWeekdayAt } from "@/lib/time";
import { log } from "@/lib/log";
import { geocodeListing } from "./geocode";
import { computeRoute, type RoutesMode } from "./routes";
import { estimateCommute } from "./estimate";
import { reserveGoogleCall } from "./usage";
import { notifyListing } from "@/lib/notify";

type Db = SupabaseClient<Database>;
type Listing = Database["public"]["Tables"]["listings"]["Row"];
type Destination = Database["public"]["Tables"]["destinations"]["Row"];
type CommuteInsert = Database["public"]["Tables"]["commutes"]["Insert"];
type Mode = Database["public"]["Enums"]["commute_mode"];

export interface EnrichDeps {
  db: Db;
  googleKey?: string;
  googleLimit: number;
  appUrl: string;
  telegram?: { token: string; chatId: string };
  /** Also compute the 18:00 return trip (one extra Routes call per destination). */
  returnTrip?: boolean;
  notify?: boolean;
  fetchImpl?: typeof fetch;
}

export interface EnrichSummary {
  enriched: number;
  notified: number;
  googleCalls: number;
  estimates: number;
  errors: number;
}

async function loadContext(db: Db) {
  const [settings, destinations, members] = await Promise.all([
    db.from("settings").select("*").eq("group_id", GROUP_ID).single(),
    db.from("destinations").select("*").eq("group_id", GROUP_ID).order("sort_order"),
    db.from("members").select("id, interns_at_sandyford, commute_mode").eq("group_id", GROUP_ID),
  ]);
  if (settings.error) throw new Error(`settings: ${settings.error.message}`);
  return { settings: settings.data, destinations: destinations.data ?? [], members: members.data ?? [] };
}

/** Commutes for one listing → all destinations. Cached per (listing, destination, mode). */
async function commutesFor(listing: Listing, destinations: Destination[], deps: EnrichDeps, stats: EnrichSummary) {
  const origin = { lat: listing.lat!, lng: listing.lng! };
  const { data: existing } = await deps.db.from("commutes").select("*").eq("listing_id", listing.id);
  const have = new Set((existing ?? []).map((c) => `${c.destination_id}:${c.mode}`));
  const rows: CommuteInsert[] = [];
  const depart = nextWeekdayAt(8, 30);
  const back = nextWeekdayAt(18, 0);

  for (const d of destinations) {
    const dest = { lat: d.lat, lng: d.lng };
    const straight = haversineM(origin, dest);
    const est = estimateCommute(origin, dest);
    const wanted: { mode: Mode; api: RoutesMode; from: typeof origin; to: typeof origin; at?: Date }[] = [
      { mode: "transit", api: "TRANSIT", from: origin, to: dest, at: depart },
      { mode: "bicycle", api: "BICYCLE", from: origin, to: dest },
    ];
    if (deps.returnTrip) wanted.push({ mode: "transit_return", api: "TRANSIT", from: dest, to: origin, at: back });
    if (straight < 3000) wanted.push({ mode: "walk", api: "WALK", from: origin, to: dest });

    for (const w of wanted) {
      if (have.has(`${d.id}:${w.mode}`)) continue;
      let row: CommuteInsert | null = null;
      if (deps.googleKey && (await reserveGoogleCall(deps.db, "routes", deps.googleLimit))) {
        stats.googleCalls++;
        try {
          const r = await computeRoute(w.from, w.to, w.api, { key: deps.googleKey, departureTime: w.at, fetchImpl: deps.fetchImpl });
          if (r) {
            row = {
              listing_id: listing.id,
              destination_id: d.id,
              mode: w.mode,
              minutes: r.minutes,
              walk_minutes: r.walkMinutes,
              transfers: r.transfers,
              distance_m: r.distanceM,
              lines: r.lines,
              source: "google",
            };
          }
        } catch (e) {
          stats.errors++;
          log.warn("routes.failed", { listingId: listing.id, mode: w.mode, error: e as Error });
        }
      }
      if (!row) {
        stats.estimates++;
        const e =
          w.mode === "bicycle" ? { minutes: est.bicycle.minutes } : w.mode === "walk" ? est.walk : est.transit;
        if (!e) continue;
        row = {
          listing_id: listing.id,
          destination_id: d.id,
          mode: w.mode,
          minutes: e.minutes,
          walk_minutes: "walkMinutes" in e ? (e.walkMinutes as number) : null,
          transfers: null,
          distance_m: est.distanceM,
          lines: "lines" in e ? (e.lines as string[]) : [],
          source: "estimate",
        };
      }
      rows.push(row);
    }
  }
  if (rows.length) {
    const { error } = await deps.db.from("commutes").upsert(rows, { onConflict: "listing_id,destination_id,mode" });
    if (error) throw new Error(`commutes upsert: ${error.message}`);
  }
  const { data: all } = await deps.db.from("commutes").select("*").eq("listing_id", listing.id);
  return all ?? [];
}

/**
 * Geocode → commutes → score → notify, for the given listing ids. Safe to re-run: every step
 * is cached (geocode cache, unique commutes, notification slots).
 */
export async function enrichListings(ids: number[], deps: EnrichDeps): Promise<EnrichSummary> {
  const stats: EnrichSummary = { enriched: 0, notified: 0, googleCalls: 0, estimates: 0, errors: 0 };
  if (ids.length === 0) return stats;
  const ctx = await loadContext(deps.db);
  const s = toSearchSettings(ctx.settings);
  const { data: listings } = await deps.db.from("listings").select("*").in("id", ids);

  for (const listing of listings ?? []) {
    try {
      if (listing.lat == null || listing.lng == null) {
        const g = await geocodeListing(listing, { db: deps.db, googleKey: deps.googleKey, googleLimit: deps.googleLimit, fetchImpl: deps.fetchImpl });
        listing.lat = g.lat;
        listing.lng = g.lng;
        listing.geocode_precision = g.precision;
        await deps.db.from("listings").update({ lat: g.lat, lng: g.lng, geocode_precision: g.precision }).eq("id", listing.id);
      }
      const commutes = await commutesFor(listing, ctx.destinations, deps, stats);
      const { data: votes } = await deps.db.from("votes").select("member_id, value, stars").eq("listing_id", listing.id);
      const score = scoreListing(listing, commutes, votes ?? [], {
        maxPerPerson: s.maxPerPerson,
        groupSizeMin: s.groupSizeMin,
        groupSizeMax: s.groupSizeMax,
        bedsMin: s.bedsMin,
        bedsMax: s.bedsMax,
        weights: ctx.settings.score_weights as unknown as Partial<ScoreWeights>,
        destinations: ctx.destinations,
        members: ctx.members,
      }).total;
      listing.score = score;
      await deps.db.from("listings").update({ score, enriched_at: new Date().toISOString() }).eq("id", listing.id);
      stats.enriched++;

      if (deps.notify !== false && listing.status === "active" && assessRental(listing, campusPoint(ctx.destinations), s.maxPerPerson).matches) {
        const sent = await notifyListing(listing, commutes, {
          db: deps.db,
          appUrl: deps.appUrl,
          maxPerPerson: s.maxPerPerson,
          bedsMin: s.bedsMin,
          bedsMax: s.bedsMax,
          threshold: ctx.settings.notify_score_threshold,
          destinations: ctx.destinations,
          telegram: deps.telegram,
          fetchImpl: deps.fetchImpl,
        });
        if (sent) stats.notified++;
      }
    } catch (e) {
      stats.errors++;
      log.error("enrich.failed", { listingId: listing.id, error: e as Error });
    }
  }
  return stats;
}
