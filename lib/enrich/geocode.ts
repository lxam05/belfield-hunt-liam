import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AREA_CENTROIDS, inDublin, type LatLng } from "@/lib/geo";
import { reserveGoogleCall } from "./usage";
import { log } from "@/lib/log";
import { EIRCODE_RE } from "@/lib/daft/parse";

type Db = SupabaseClient<Database>;

export interface GeocodeResult extends LatLng {
  precision: "eircode" | "rooftop" | "street" | "area" | "fallback";
  formatted?: string;
}

export interface GeocodeDeps {
  db: Db;
  googleKey?: string;
  googleLimit: number;
  fetchImpl?: typeof fetch;
}

const LOCATION_TYPE: Record<string, GeocodeResult["precision"]> = {
  ROOFTOP: "rooftop",
  RANGE_INTERPOLATED: "street",
  GEOMETRIC_CENTER: "street",
  APPROXIMATE: "area",
};

function cacheKey(q: string) {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

async function googleGeocode(q: string, isEircode: boolean, deps: GeocodeDeps): Promise<GeocodeResult | null> {
  if (!deps.googleKey) return null;
  if (!(await reserveGoogleCall(deps.db, "geocoding", deps.googleLimit))) {
    log.warn("google.kill_switch", { sku: "geocoding" });
    return null;
  }
  const params = new URLSearchParams({
    address: q,
    components: "country:IE",
    bounds: "53.20,-6.45|53.42,-6.05", // bias to south/central Dublin
    region: "ie",
    key: deps.googleKey,
  });
  const res = await (deps.fetchImpl ?? fetch)(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    status: string;
    results?: { formatted_address: string; geometry: { location: { lat: number; lng: number }; location_type: string } }[];
  };
  const r = body.results?.[0];
  if (body.status !== "OK" || !r) return null;
  const p = { lat: r.geometry.location.lat, lng: r.geometry.location.lng };
  if (!inDublin(p)) return null;
  return {
    ...p,
    precision: isEircode ? "eircode" : (LOCATION_TYPE[r.geometry.location_type] ?? "area"),
    formatted: r.formatted_address,
  };
}

/** Nominatim's usage policy allows at most 1 request per second. */
let lastNominatim = 0;
async function nominatimThrottle() {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
}

/** Free fallback when no Google key is configured: OSM Nominatim (≤1 req/s by policy). */
async function nominatim(q: string, deps: GeocodeDeps): Promise<GeocodeResult | null> {
  if (process.env.DISABLE_NOMINATIM === "1") return null;
  await nominatimThrottle();
  try {
    const params = new URLSearchParams({ q, format: "json", limit: "1", countrycodes: "ie", viewbox: "-6.45,53.42,-6.05,53.20" });
    const res = await (deps.fetchImpl ?? fetch)(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": "BelfieldHunt/1.0 (private student project)" },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as { lat: string; lon: string; display_name: string; class?: string; type?: string }[];
    if (!arr[0]) return null;
    const p = { lat: Number(arr[0].lat), lng: Number(arr[0].lon) };
    if (!inDublin(p)) return null;
    const precise = arr[0].class === "building" || (arr[0].class === "place" && arr[0].type === "house");
    return { ...p, precision: precise ? "rooftop" : arr[0].class === "highway" ? "street" : "area", formatted: arr[0].display_name };
  } catch {
    return null;
  }
}

async function cached(q: string, deps: GeocodeDeps, resolve: () => Promise<GeocodeResult | null>) {
  const key = cacheKey(q);
  const { data: hit } = await deps.db.from("geocode_cache").select("*").eq("query", key).maybeSingle();
  if (hit && hit.lat != null && hit.lng != null) {
    return { lat: hit.lat, lng: hit.lng, precision: (hit.precision ?? "street") as GeocodeResult["precision"], formatted: hit.formatted_address ?? undefined };
  }
  if (hit) return null; // cached miss
  const r = await resolve();
  await deps.db.from("geocode_cache").upsert({
    query: key,
    lat: r?.lat ?? null,
    lng: r?.lng ?? null,
    precision: r?.precision ?? null,
    formatted_address: r?.formatted ?? null,
  });
  return r;
}

const STREET_RE =
  /\b(road|rd|street|st|avenue|ave|park|grove|lane|drive|court|green|close|terrace|crescent|way|place|square|hill|gardens|manor|view|walk|rise|heights|vale|mews|row|downs|lawn|lawns|wood|woods|parade|quay|gate)\b/i;

/**
 * Progressively simpler queries for a Daft title, e.g.
 * "Apartment 12, The Grange, Stillorgan Road, Stillorgan, Co. Dublin (6-7 Month Let)" →
 *   1. full title, 2. without unit/notes/duplicates, 3. "Stillorgan Road, Stillorgan, Dublin".
 */
export function geocodeQueryVariants(title: string): string[] {
  const out: string[] = [`${title}, Ireland`];
  const parts = title
    .replace(/\([^)]*\)/g, "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(apartment|apt|flat|unit|no\.?|house|duplex|penthouse)\s*\d+[a-z]?$/i.test(p))
    .map((p) => p.replace(/^(apartment|apt|flat|unit|no\.?)\s*\d+[a-z]?\s+/i, ""))
    .filter((p, i, arr) => arr.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i)
    .filter((p) => !/^(co\.?\s*)?dublin(\s?\d{1,2}w?)?$/i.test(p) && !/^ireland$/i.test(p) && !EIRCODE_RE.test(p.toUpperCase()));
  const district = title.match(/\bDublin\s?\d{1,2}W?\b/i)?.[0] ?? "Dublin";
  if (parts.length) out.push(`${parts.join(", ")}, ${district}, Ireland`);
  const streetIdx = parts.findLastIndex((p) => STREET_RE.test(p));
  if (streetIdx >= 0) {
    const street = parts[streetIdx].replace(/^\d+[a-z]?\s+/i, "");
    const area = parts[parts.length - 1];
    out.push(`${street}${area && area !== parts[streetIdx] ? `, ${area}` : ""}, ${district}, Ireland`);
  }
  return [...new Set(out)];
}

/**
 * Geocode a listing title. Eircode first (more precise), then "<title>, Ireland" biased to
 * Dublin, then the area centroid. Results are cached by query, so re-listed addresses and
 * replays never cost a second call.
 */
export async function geocodeListing(
  l: { title: string; eircode: string | null; area: string | null; suburb?: string | null },
  deps: GeocodeDeps,
): Promise<GeocodeResult> {
  const tryQuery = async (q: string, isEircode: boolean) =>
    cached(q, deps, async () => (await googleGeocode(q, isEircode, deps)) ?? (deps.googleKey ? null : await nominatim(q, deps)));

  if (l.eircode) {
    const r = await tryQuery(l.eircode, true);
    if (r) return { ...r, precision: deps.googleKey ? "eircode" : r.precision };
  }
  // Google copes with messy titles, so one query is enough. Nominatim needs simpler variants.
  const variants = geocodeQueryVariants(l.title);
  for (const q of deps.googleKey ? variants.slice(0, 1) : variants) {
    const r = await tryQuery(q, false);
    if (r) return r;
  }
  const c = (l.suburb && AREA_CENTROIDS[l.suburb]) || (l.area && AREA_CENTROIDS[l.area]) || AREA_CENTROIDS["Co. Dublin"];
  return { ...c, precision: l.area && AREA_CENTROIDS[l.area] ? "area" : "fallback" };
}
