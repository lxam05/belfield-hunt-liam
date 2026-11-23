import { haversineM, type LatLng } from "@/lib/geo";
import stopsData from "@/lib/transit/stops.json";

/**
 * Free fallback when no Google key is set (or the monthly kill switch is hit):
 * straight-line distance with a road-detour factor, plus a transit estimate built from the
 * nearest Luas/bus stop (from the committed GTFS extract). Always labelled "estimate".
 */

/** Compact stops: [lat, lng, kind] where kind is "L" (Luas) or "B" (bus). */
const STOPS = (stopsData as unknown as { stops: [number, number, string][] }).stops;

const DETOUR = 1.3;
const WALK_KMH = 4.8;
const BIKE_KMH = 16;
const BUS_KMH = 15;
const LUAS_KMH = 22;
const WAIT_MIN = 6;

export interface NearestStop {
  distanceM: number;
  kind: "L" | "B";
}

export function nearestStop(p: LatLng, kind?: "L" | "B"): NearestStop | null {
  let best: NearestStop | null = null;
  for (const [lat, lng, k] of STOPS) {
    if (kind && k !== kind) continue;
    const d = haversineM(p, { lat, lng });
    if (!best || d < best.distanceM) best = { distanceM: d, kind: k as "L" | "B" };
  }
  return best;
}

const minutes = (metres: number, kmh: number) => (metres / 1000 / kmh) * 60;

export interface Estimate {
  transit: { minutes: number; walkMinutes: number; lines: string[] };
  bicycle: { minutes: number };
  walk: { minutes: number } | null;
  distanceM: number;
}

export function estimateCommute(origin: LatLng, dest: LatLng): Estimate {
  const d = haversineM(origin, dest);
  const road = d * DETOUR;
  const luasA = nearestStop(origin, "L");
  const luasB = nearestStop(dest, "L");
  const anyA = nearestStop(origin);
  const anyB = nearestStop(dest);
  const useLuas = !!luasA && !!luasB && luasA.distanceM < 900 && luasB.distanceM < 900;
  const walkA = useLuas ? luasA!.distanceM : (anyA?.distanceM ?? 400);
  const walkB = useLuas ? luasB!.distanceM : (anyB?.distanceM ?? 400);
  const walkMin = minutes((walkA + walkB) * DETOUR, WALK_KMH);
  const ride = minutes(road, useLuas ? LUAS_KMH : BUS_KMH);
  const walkOnly = minutes(road, WALK_KMH);
  const transitMin = Math.min(walkOnly, walkMin + WAIT_MIN + ride);
  return {
    transit: { minutes: Math.round(transitMin), walkMinutes: Math.round(walkMin), lines: useLuas ? ["Green Line (est.)"] : [] },
    bicycle: { minutes: Math.round(minutes(road, BIKE_KMH) + 2) },
    walk: d < 3000 ? { minutes: Math.round(walkOnly) } : null,
    distanceM: Math.round(d),
  };
}
