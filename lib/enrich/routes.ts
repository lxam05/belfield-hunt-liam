import type { LatLng } from "@/lib/geo";

/**
 * Google Routes API `computeRoutes`, server-side only. Field masks request only what we store,
 * and we never use TRAFFIC_AWARE routing, waypoints or departure "now", so every call bills
 * as "Compute Routes Essentials" (10,000 free per month).
 */

export type RoutesMode = "TRANSIT" | "BICYCLE" | "WALK";

export interface RouteResult {
  minutes: number;
  distanceM: number;
  walkMinutes: number | null;
  transfers: number | null;
  lines: string[];
}

const FIELD_MASK_SIMPLE = "routes.duration,routes.distanceMeters";
const FIELD_MASK_TRANSIT = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.transitDetails.transitLine.nameShort",
  "routes.legs.steps.transitDetails.transitLine.name",
  "routes.legs.steps.transitDetails.transitLine.vehicle.type",
].join(",");

interface ApiStep {
  travelMode?: string;
  staticDuration?: string;
  transitDetails?: { transitLine?: { nameShort?: string; name?: string; vehicle?: { type?: string } } };
}
interface ApiResponse {
  routes?: { duration?: string; distanceMeters?: number; legs?: { steps?: ApiStep[] }[] }[];
  error?: { message?: string };
}

function seconds(d: string | undefined): number {
  return d ? Number(d.replace(/s$/, "")) || 0 : 0;
}

/** Pure parser (unit-tested). */
export function parseRoutesResponse(body: ApiResponse, mode: RoutesMode): RouteResult | null {
  const r = body.routes?.[0];
  if (!r?.duration) return null;
  const minutes = Math.round(seconds(r.duration) / 60);
  if (mode !== "TRANSIT") return { minutes, distanceM: r.distanceMeters ?? 0, walkMinutes: null, transfers: null, lines: [] };
  const steps = (r.legs ?? []).flatMap((l) => l.steps ?? []);
  const walkSecs = steps.filter((s) => s.travelMode === "WALK").reduce((a, s) => a + seconds(s.staticDuration), 0);
  const transitSteps = steps.filter((s) => s.travelMode === "TRANSIT");
  const lines: string[] = [];
  for (const s of transitSteps) {
    const line = s.transitDetails?.transitLine;
    const name = line?.nameShort || line?.name;
    if (name && !lines.includes(name)) lines.push(name);
  }
  return {
    minutes,
    distanceM: r.distanceMeters ?? 0,
    walkMinutes: Math.round(walkSecs / 60),
    transfers: Math.max(0, transitSteps.length - 1),
    lines,
  };
}

export async function computeRoute(
  origin: LatLng,
  destination: LatLng,
  mode: RoutesMode,
  opts: { key: string; departureTime?: Date; fetchImpl?: typeof fetch },
): Promise<RouteResult | null> {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: mode,
    languageCode: "en-IE",
    units: "METRIC",
  };
  if (mode === "TRANSIT" && opts.departureTime) body.departureTime = opts.departureTime.toISOString();
  const res = await (opts.fetchImpl ?? fetch)("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": opts.key,
      "X-Goog-FieldMask": mode === "TRANSIT" ? FIELD_MASK_TRANSIT : FIELD_MASK_SIMPLE,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as ApiResponse;
  if (!res.ok) throw new Error(`Routes API ${res.status}: ${json.error?.message ?? "unknown"}`);
  return parseRoutesResponse(json, mode);
}
