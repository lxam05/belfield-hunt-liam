/**
 * pnpm transit:refresh — build compact transit layers from the TFI GTFS static feed.
 * Build-time only: outputs are committed, nothing is downloaded at runtime. Run monthly.
 *
 * Outputs:
 *   public/transit/stops.geojson     bus + Luas stops in the search bbox
 *   public/transit/routes.geojson    Luas Green Line + bus routes serving a stop ≤400 m from
 *                                    either destination (simplified with turf)
 *   public/transit/routes-index.json route short name → colour, operator, destinations served
 *   lib/transit/stops.json           compact [lat, lng, kind] for the server-side estimator
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { Unzip, UnzipInflate } from "fflate";
import simplify from "@turf/simplify";
import { lineString } from "@turf/helpers";

const GTFS_URL = process.env.GTFS_URL ?? "https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip";
const CACHE_DIR = path.resolve(".gtfs-cache");
const ZIP = path.join(CACHE_DIR, "gtfs.zip");
const BBOX = { minLat: 53.24, maxLat: 53.35, minLng: -6.33, maxLng: -6.13 };
const DESTS = [
  { name: "UCD", lat: 53.3075, lng: -6.2236 },
  { name: "Sandyford", lat: 53.2705, lng: -6.204 },
];
const SERVE_RADIUS_M = 400;

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function download() {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(ZIP) && Date.now() - statSync(ZIP).mtimeMs < 7 * 864e5 && !process.argv.includes("--force")) {
    console.log("Using cached GTFS zip (<7 days old). Pass --force to re-download.");
    return;
  }
  console.log(`Downloading ${GTFS_URL} …`);
  const res = await fetch(GTFS_URL);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(ZIP));
  console.log(`Saved ${(statSync(ZIP).size / 1e6).toFixed(1)} MB`);
}

/** Parse one CSV line (GTFS uses RFC-4180 quoting). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Stream selected files from the zip, calling onRow(file, record) for every CSV row. */
async function streamFiles(files: string[], onRow: (file: string, row: Record<string, string>) => void) {
  const wanted = new Set(files);
  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (f) => {
      const name = path.basename(f.name);
      if (!wanted.has(name)) return;
      let header: string[] | null = null;
      let rest = "";
      const decoder = new TextDecoder();
      f.ondata = (err, chunk, final) => {
        if (err) return reject(err);
        rest += decoder.decode(chunk, { stream: !final });
        const lines = rest.split(/\r?\n/);
        rest = final ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line) continue;
          const cells = parseLine(line);
          if (!header) {
            header = cells.map((h) => h.replace(/^﻿/, "").trim());
            continue;
          }
          const rec: Record<string, string> = {};
          header.forEach((h, i) => (rec[h] = cells[i] ?? ""));
          onRow(name, rec);
        }
      };
      f.start();
    };
    const stream = createReadStream(ZIP, { highWaterMark: 1 << 20 });
    stream.on("data", (c) => unzip.push(c as Uint8Array));
    stream.on("end", () => {
      unzip.push(new Uint8Array(0), true);
      // fflate processes synchronously; give pending callbacks a tick.
      setImmediate(resolve);
    });
    stream.on("error", reject);
  });
}

async function main() {
  await download();

  // Pass 1: small tables.
  const agencies = new Map<string, string>();
  const routes = new Map<string, { short: string; long: string; type: number; agency: string; colour: string }>();
  const stops = new Map<string, { name: string; code: string; lat: number; lng: number }>();
  const trips = new Map<string, { route: string; shape: string }>();
  console.log("Pass 1: agency, routes, stops, trips …");
  await streamFiles(["agency.txt", "routes.txt", "stops.txt", "trips.txt"], (file, r) => {
    if (file === "agency.txt") agencies.set(r.agency_id, r.agency_name);
    else if (file === "routes.txt")
      routes.set(r.route_id, {
        short: r.route_short_name || r.route_long_name,
        long: r.route_long_name,
        type: Number(r.route_type),
        agency: r.agency_id,
        colour: r.route_color ? `#${r.route_color}` : "",
      });
    else if (file === "stops.txt") {
      const lat = Number(r.stop_lat);
      const lng = Number(r.stop_lon);
      if (lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng) {
        stops.set(r.stop_id, { name: r.stop_name, code: r.stop_code, lat, lng });
      }
    } else if (file === "trips.txt") trips.set(r.trip_id, { route: r.route_id, shape: r.shape_id });
  });
  console.log(`  ${routes.size} routes, ${stops.size} stops in bbox, ${trips.size} trips`);

  const nearDest = new Map<string, string[]>(); // stop_id → destinations within radius
  for (const [id, s] of stops) {
    const near = DESTS.filter((d) => haversine(s, d) <= SERVE_RADIUS_M).map((d) => d.name);
    if (near.length) nearDest.set(id, near);
  }

  // Pass 2: stop_times → which routes serve bbox stops and destination stops.
  console.log("Pass 2: stop_times (large) …");
  const stopKinds = new Map<string, Set<string>>(); // stop → 'luas' | 'bus'
  const routeServes = new Map<string, Set<string>>(); // route_id → destinations
  const shapeCount = new Map<string, Map<string, number>>(); // route_id → shape → trips
  const isLuas = (routeId: string) => routes.get(routeId)?.type === 0;
  const bboxRoutes = new Set<string>();
  let n = 0;
  await streamFiles(["stop_times.txt"], (_f, r) => {
    if (++n % 5_000_000 === 0) console.log(`  … ${n / 1e6}M rows`);
    if (!stops.has(r.stop_id)) return;
    const trip = trips.get(r.trip_id);
    if (!trip) return;
    bboxRoutes.add(trip.route);
    const kinds = stopKinds.get(r.stop_id) ?? new Set();
    kinds.add(isLuas(trip.route) ? "luas" : "bus");
    stopKinds.set(r.stop_id, kinds);
    const near = nearDest.get(r.stop_id);
    const route = routes.get(trip.route);
    const greenLine = route?.type === 0 && /green/i.test(`${route.short} ${route.long}`);
    if (near || greenLine) {
      const set = routeServes.get(trip.route) ?? new Set();
      for (const d of near ?? []) set.add(d);
      routeServes.set(trip.route, set);
      const sc = shapeCount.get(trip.route) ?? new Map();
      sc.set(trip.shape, (sc.get(trip.shape) ?? 0) + 1);
      shapeCount.set(trip.route, sc);
    }
  });
  console.log(`  ${n} stop_times rows; ${routeServes.size} routes serve a destination`);

  // Keep the two most common shapes per route (usually one per direction).
  const keepShapes = new Map<string, string>(); // shape → route
  for (const [routeId, sc] of shapeCount) {
    [...sc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([shape]) => shape && keepShapes.set(shape, routeId));
  }

  // Pass 3: shapes.
  console.log("Pass 3: shapes …");
  const shapePts = new Map<string, [number, number, number][]>();
  await streamFiles(["shapes.txt"], (_f, r) => {
    if (!keepShapes.has(r.shape_id)) return;
    const arr = shapePts.get(r.shape_id) ?? [];
    arr.push([Number(r.shape_pt_sequence), Number(r.shape_pt_lon), Number(r.shape_pt_lat)]);
    shapePts.set(r.shape_id, arr);
  });

  // Colours: Luas Green official, buses from a fixed palette by route.
  const PALETTE = ["#2563eb", "#db2777", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#0d9488", "#9333ea", "#c2410c", "#0284c7"];
  const index: Record<string, { colour: string; operator: string; kind: "luas" | "bus"; serves: string[]; longName: string }> = {};
  let p = 0;
  const sortedRoutes = [...routeServes.keys()].sort((a, b) => (routes.get(a)!.short ?? "").localeCompare(routes.get(b)!.short ?? "", undefined, { numeric: true }));
  for (const routeId of sortedRoutes) {
    const r = routes.get(routeId)!;
    const kind = r.type === 0 ? "luas" : "bus";
    const key = kind === "luas" ? "Green Line" : r.short;
    if (index[key]) {
      for (const d of routeServes.get(routeId)!) if (!index[key].serves.includes(d)) index[key].serves.push(d);
      continue;
    }
    index[key] = {
      colour: kind === "luas" ? "#00af3f" : PALETTE[p++ % PALETTE.length],
      operator: agencies.get(r.agency) ?? r.agency,
      kind,
      serves: [...routeServes.get(routeId)!].sort(),
      longName: r.long,
    };
  }

  const routeFeatures = [];
  for (const [shape, routeId] of keepShapes) {
    const pts = shapePts.get(shape);
    if (!pts || pts.length < 2) continue;
    const r = routes.get(routeId)!;
    const key = r.type === 0 ? "Green Line" : r.short;
    pts.sort((a, b) => a[0] - b[0]);
    const line = simplify(lineString(pts.map(([, lng, lat]) => [lng, lat])), { tolerance: 0.00008, highQuality: false });
    const coords = (line.geometry.coordinates as number[][]).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);
    routeFeatures.push({
      type: "Feature",
      properties: { route: key, kind: index[key].kind, colour: index[key].colour, serves: index[key].serves.join(","), operator: index[key].operator },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  const stopFeatures = [];
  const compact: [number, number, string][] = [];
  for (const [id, s] of stops) {
    const kinds = stopKinds.get(id);
    if (!kinds) continue; // unused stop
    const kind = kinds.has("luas") ? "luas" : "bus";
    stopFeatures.push({
      type: "Feature",
      properties: { id, name: s.name, code: s.code, kind },
      geometry: { type: "Point", coordinates: [Number(s.lng.toFixed(5)), Number(s.lat.toFixed(5))] },
    });
    compact.push([Number(s.lat.toFixed(5)), Number(s.lng.toFixed(5)), kind === "luas" ? "L" : "B"]);
  }

  mkdirSync("public/transit", { recursive: true });
  const generatedAt = new Date().toISOString();
  writeFileSync("public/transit/stops.geojson", JSON.stringify({ type: "FeatureCollection", generatedAt, features: stopFeatures }));
  writeFileSync("public/transit/routes.geojson", JSON.stringify({ type: "FeatureCollection", generatedAt, features: routeFeatures }));
  writeFileSync("public/transit/routes-index.json", JSON.stringify({ generatedAt, source: GTFS_URL, routes: index }, null, 1));
  writeFileSync("lib/transit/stops.json", JSON.stringify({ generatedAt, stops: compact }));
  const routeNames: Record<string, string> = {};
  for (const id of bboxRoutes) routeNames[id] = routes.get(id)!.type === 0 ? `Luas ${routes.get(id)!.short}` : routes.get(id)!.short;
  writeFileSync("lib/transit/route-names.json", JSON.stringify(routeNames));
  console.log(`Wrote ${stopFeatures.length} stops, ${routeFeatures.length} route shapes, ${Object.keys(index).length} routes in index.`);
}

main().catch((e) => {
  console.error("✖", e);
  process.exit(1);
});
