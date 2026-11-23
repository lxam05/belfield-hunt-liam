import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requireMember } from "@/lib/auth/api";
import routeNames from "@/lib/transit/route-names.json";


/**
 * Live departures near a stop from NTA GTFS-Realtime v2 (optional; needs NTA_API_KEY).
 * The TripUpdates feed is large, so it is cached in memory for 30 s per function instance.
 * GTFS-R carries delays/predicted times for trips already running or about to start; it is
 * not a full timetable, so a quiet stop can legitimately show nothing.
 */
type Json = Record<string, unknown>;
let cache: { at: number; entities: Json[] } | null = null;

const pick = (o: Json | undefined, ...keys: string[]): unknown => {
  for (const k of keys) if (o && o[k] !== undefined) return o[k];
  return undefined;
};

async function feed(key: string): Promise<Json[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.entities;
  const res = await fetch("https://api.nationaltransport.ie/gtfsr/v2/TripUpdates?format=json", {
    headers: { "x-api-key": key, "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error(`NTA ${res.status}`);
  const body = (await res.json()) as Json;
  const entities = (pick(body, "entity", "Entity") as Json[]) ?? [];
  cache = { at: Date.now(), entities };
  return entities;
}

export async function GET(req: NextRequest) {
  const me = await requireMember();
  if (me instanceof NextResponse) return me;
  const key = env().NTA_API_KEY;
  if (!key) return NextResponse.json({ enabled: false, departures: [] });
  const stopId = req.nextUrl.searchParams.get("stopId");
  if (!stopId || !/^[\w.:-]{1,40}$/.test(stopId)) return NextResponse.json({ error: "stopId required" }, { status: 400 });

  try {
    const now = Math.floor(Date.now() / 1000);
    const names = routeNames as Record<string, string>;
    const out: { route: string; inMinutes: number | null; delayMin: number | null; time: string | null }[] = [];
    for (const e of await feed(key)) {
      const tu = pick(e, "trip_update", "tripUpdate") as Json | undefined;
      if (!tu) continue;
      const trip = pick(tu, "trip") as Json | undefined;
      const updates = (pick(tu, "stop_time_update", "stopTimeUpdate") as Json[]) ?? [];
      for (const u of updates) {
        if (String(pick(u, "stop_id", "stopId")) !== stopId) continue;
        const ev = (pick(u, "departure") ?? pick(u, "arrival")) as Json | undefined;
        const t = Number(pick(ev, "time")) || null;
        const delay = pick(ev, "delay");
        if (t != null && t < now - 60) continue;
        const routeId = String(pick(trip, "route_id", "routeId") ?? "");
        out.push({
          route: names[routeId] ?? routeId,
          inMinutes: t ? Math.max(0, Math.round((t - now) / 60)) : null,
          delayMin: delay != null ? Math.round(Number(delay) / 60) : null,
          time: t ? new Date(t * 1000).toISOString() : null,
        });
      }
    }
    out.sort((a, b) => (a.inMinutes ?? 999) - (b.inMinutes ?? 999));
    return NextResponse.json({ enabled: true, departures: out.slice(0, 12) });
  } catch (e) {
    return NextResponse.json({ enabled: true, error: (e as Error).message, departures: [] }, { status: 502 });
  }
}
