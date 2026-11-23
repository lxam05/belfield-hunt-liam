"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";

import { MAP_STYLE_URL } from "@/lib/supabase/public-env";
import Link from "next/link";
import { campusPoint } from "@/lib/rental-search";
import { useDestinations, useMe, useMembers, useRows, useSearchSettings } from "@/lib/store/hooks";
import { hide, setStage, updateDestination, vote } from "@/lib/store/actions";
import type { Destination } from "@/lib/store/types";
import { Button } from "@/components/ui/button";
import { isUnreviewed } from "@/lib/listing-review";
import { useSearchResults } from "./use-search-results";
import { bedsText, rentText } from "./bits";

interface RouteIndexEntry {
  colour: string;
  operator: string;
  kind: "luas" | "bus";
  serves: string[];
  longName: string;
}

const CENTER: [number, number] = [-6.225, 53.295];
/** "I like this" pins: hot pink, so they stand out from matches (green) and others (grey). */
const LIKED_COLOUR = "#e11d74";
const isLiked = (r: { votes: { value: number }[] }) => r.votes.some((v) => v.value > 0);

/** Polygon approximating a circle of `km` around a point (for the distance rings). */
function ring(lng: number, lat: number, km: number, steps = 64): [number, number][] {
  const out: [number, number][] = [];
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

function ringsGeoJson(dests: Destination[]) {
  const campus = campusPoint(dests);
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { label: "5 km" },
        geometry: { type: "LineString" as const, coordinates: ring(campus.lng, campus.lat, 5) },
      },
    ],
  };
}

function selectListing(id: number | null) {
  const url = new URL(window.location.href);
  if (id == null) url.searchParams.delete("focus");
  else url.searchParams.set("focus", String(id));
  window.history.replaceState(null, "", url);
}

export function MapView({
  editDestinations = false,
  heightClass = "h-[calc(100dvh-7.5rem)] md:h-[calc(100dvh-3rem)]",
}: {
  editDestinations?: boolean;
  heightClass?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [overlap, setOverlap] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [mapError, setMapError] = useState(false);
  const framed = useRef<string | null>(null);
  const [layers, setLayers] = useState({
    luas: false,
    bus: false,
    stops: false,
    rings: true,
    listings: true,
  });
  const [routeIndex, setRouteIndex] = useState<Record<string, RouteIndexEntry>>({});
  const [departures, setDepartures] = useState<{
    name: string;
    items: { route: string; inMinutes: number | null; delayMin: number | null }[];
    note?: string;
  } | null>(null);
  const member = useMe();
  const members = useMembers();
  const seenKey = "belfield:opened:" + (member?.id ?? "local");
  const [seen, setSeen] = useState<number[]>(() => {
    try {
      const ids = JSON.parse(localStorage.getItem(seenKey) ?? "[]");
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  });
  const rows = useRows();
  const destinations = useDestinations();
  const search = useSearchSettings();
  const params = useSearchParams();
  const legacyNew = params.get("show") === "new";
  const mode = legacyNew ? "all" : params.get("show") ?? "matches";
  const onlyNew = !editDestinations && (legacyNew || params.get("new") === "1");
  const searchRun = params.get("run") ?? "";
  const { isNew, loading: searchLoading, error: searchError, runId } = useSearchResults(onlyNew ? searchRun : "", onlyNew);
  function setMode(value: string, newOnly = onlyNew) {
    const url = new URL(window.location.href);
    url.searchParams.set("show", value);
    if (newOnly) url.searchParams.set("new", "1");
    else url.searchParams.delete("new");
    setOverlap([]);
    url.searchParams.delete("focus");
    window.history.replaceState(null, "", url);
  }
  const focus = Number(params.get("focus")) || null;

  const active = useMemo(
    () => rows.filter((r) => (mode === "all" || !r.pipeline?.hidden) && r.listing.status !== "gone"),
    [rows, mode],
  );
  const selected = active.find((r) => r.listing.id === focus);
  const myVote = selected?.votes.find((v) => v.member_id === member?.id)?.value ?? 0;
  const selectedId = selected?.listing.id;
  useEffect(() => {
    if (!selectedId || seen.includes(selectedId)) return;
    const next = [...seen, selectedId];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen(next);
    try {
      localStorage.setItem(seenKey, JSON.stringify(next));
    } catch {
      /* Browsing remains available. */
    }
  }, [selectedId, seen, seenKey]);
  const visibleRows = useMemo(
    () =>
      active
        .filter((r) => {
          if (onlyNew && !isNew(r)) return false;
          if (mode === "unreviewed") return isUnreviewed(r);
          if (mode === "matches") return r.fits || isLiked(r);
          if (mode === "liked") return isLiked(r);
          if (mode === "checking")
            return r.assessment.distance == null || r.assessment.rent == null;
          if (mode === "maybe") return r.pipeline?.stage === "shortlisted";
          if (mode === "applied") return r.pipeline?.stage === "applied";
          return true;
        })
        .sort((a, b) => onlyNew || mode === "unreviewed"
          ? Date.parse(b.listing.first_seen_at) - Date.parse(a.listing.first_seen_at)
          : b.score.total - a.score.total),
    [active, mode, onlyNew, isNew],
  );
  const reviewing = onlyNew || mode === "unreviewed";
  const selectedIndex = visibleRows.findIndex((r) => r.listing.id === focus);
  const nextRow = visibleRows[selectedIndex + 1];
  const listingsGeo = useMemo(() => {
    const groups = new Map<
      string,
      { coordinates: number[]; ids: number[]; label: string; colour: string; liked: boolean }
    >();
    const addresses = new Map<string,string>();
    for (const r of !reviewing && selected && !visibleRows.includes(selected)
      ? [...visibleRows, selected]
      : visibleRows) {
      const areaOnly = r.listing.geocode_precision === "area";
      if ((!areaOnly && r.assessment.distance == null) || r.listing.lat == null || r.listing.lng == null) continue;
      const coordinates = [r.listing.lng!, r.listing.lat!];
      const address = r.listing.title.toLocaleLowerCase().replace(/[.,]/g,"").replace(/\s+/g," ").trim();
      const key = addresses.get(address) ?? coordinates.join(",");
      addresses.set(address,key);
      const group = groups.get(key) ?? {
        coordinates,
        ids: [],
        label: areaOnly ? "Area" : r.assessment.rent == null ? "?" : "€" + Math.floor(r.assessment.rent),
        colour: isLiked(r) ? LIKED_COLOUR : r.fits ? "#145747" : "#575e65",
        liked: false,
      };
      group.ids.push(r.listing.id);
      if (isLiked(r)) {
        group.liked = true;
        group.colour = LIKED_COLOUR;
      }
      if (group.ids.includes(focus ?? -1)) group.colour = "#ae462a";
      groups.set(key, group);
    }
    return {
      type: "FeatureCollection" as const,
      features: [...groups.values()].map((g) => ({
        type: "Feature" as const,
        properties: {
          ids: g.ids.join(","),
          colour: g.colour,
          liked: g.liked,
          label:
            (g.ids.some((id) => !seen.includes(id)) ? "• " : "") +
            (g.ids.length > 1 ? String(g.ids.length) + " homes" : g.label),
        },
        geometry: { type: "Point" as const, coordinates: g.coordinates },
      })),
    };
  }, [visibleRows, selected, focus, seen, reviewing]);

  // Init map once.
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      // Worker copied to public/ by scripts/copy-maplibre-worker.mjs (bundling breaks the default URL).
      maplibregl.setWorkerUrl(`/maplibre/worker-${maplibregl.getVersion()}.mjs`);
      const map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: CENTER,
        zoom: 12,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      observer = new ResizeObserver(() => map.resize());
      observer.observe(container.current);
      let styleReady = false;
      let retried = false;
      function fallback() {
        if (cancelled || styleReady) return;
        if (retried) {
          setMapError(true);
          return;
        }
        retried = true;
        map.setStyle({
          version: 8,
          glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
          sources: {
            streets: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "streets", type: "raster", source: "streets" }],
        });
      }
      fallbackTimer = setTimeout(fallback, 8000);
      map.on("error", fallback);
      (window as unknown as { __bhMap?: MlMap }).__bhMap = map; // for e2e tests / debugging
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
        "top-right",
      );
      map.once("style.load", () => {
        styleReady = true;
        clearTimeout(fallbackTimer);
        const empty = { type: "FeatureCollection" as const, features: [] };
        map.addSource("routes", { type: "geojson", data: empty });
        map.addSource("stops", { type: "geojson", data: empty });
        void Promise.all(
          ["routes.geojson", "stops.geojson", "routes-index.json"].map(async (file) => {
            const response = await fetch("/transit/" + file);
            if (!response.ok) throw new Error("Transit layer unavailable");
            return response.json();
          }),
        )
          .then(([routes, stops, idx]) => {
            if (cancelled) return;
            (map.getSource("routes") as GeoJSONSource).setData(routes);
            (map.getSource("stops") as GeoJSONSource).setData(stops);
            setRouteIndex(idx.routes ?? {});
          })
          .catch(() => {});
        map.addSource("rings", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addSource("listings", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "rings",
          type: "line",
          source: "rings",
          paint: {
            "line-color": "#6366f1",
            "line-width": 1.5,
            "line-dasharray": [2, 2],
            "line-opacity": 0.7,
          },
          layout: { visibility: "none" },
        });
        map.addLayer({
          id: "rings-label",
          type: "symbol",
          source: "rings",
          layout: {
            "symbol-placement": "line",
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            visibility: "none",
          },
          paint: { "text-color": "#6366f1", "text-halo-color": "#fff", "text-halo-width": 1 },
        });
        map.addLayer({
          id: "bus",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "kind"], "bus"],
          paint: { "line-color": ["get", "colour"], "line-width": 2.5, "line-opacity": 0.75 },
          layout: { visibility: "none", "line-cap": "round" },
        });
        map.addLayer({
          id: "luas",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "kind"], "luas"],
          paint: { "line-color": "#00af3f", "line-width": 5, "line-opacity": 0.9 },
          layout: { "line-cap": "round" },
        });
        map.addLayer({
          id: "stops",
          type: "circle",
          source: "stops",
          minzoom: 13,
          paint: {
            "circle-radius": ["case", ["==", ["get", "kind"], "luas"], 5, 3],
            "circle-color": ["case", ["==", ["get", "kind"], "luas"], "#00af3f", "#2563eb"],
            "circle-stroke-width": 1,
            "circle-stroke-color": "#fff",
          },
          layout: { visibility: "none" },
        });
        map.addLayer({
          id: "listings",
          type: "circle",
          source: "listings",
          paint: {
            "circle-radius": ["case", ["get", "liked"], 25, 21],
            "circle-color": ["get", "colour"],
            "circle-stroke-width": ["case", ["get", "liked"], 4, 2],
            "circle-stroke-color": ["case", ["get", "liked"], "#fde047", "#ffffff"],
          },
        });
        map.addLayer({
          id: "listings-label",
          type: "symbol",
          source: "listings",
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 11,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#fff" },
        });

        map.on("click", "listings", (e) => {
          const ids = [
            ...new Set(
              (e.features ?? []).flatMap((f) => String(f.properties?.ids).split(",").map(Number)),
            ),
          ];
          if (ids.length === 1) {
            setOverlap([]);
            selectListing(ids[0]);
          } else {
            selectListing(null);
            setOverlap(ids);
            setBrowse(false);
          }
        });
        map.on("click", "stops", async (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const name = String(f.properties?.name ?? "Stop");
          setDepartures({ name, items: [], note: "Loading live departures…" });
          try {
            const r = await fetch(
              `/api/transit/departures?stopId=${encodeURIComponent(String(f.properties?.id))}`,
            );
            const j = await r.json();
            if (!j.enabled)
              setDepartures({
                name,
                items: [],
                note: "Live departures need an NTA_API_KEY (optional).",
              });
            else
              setDepartures({
                name,
                items: j.departures ?? [],
                note:
                  j.error ??
                  (j.departures?.length ? undefined : "No live updates for this stop right now."),
              });
          } catch {
            setDepartures({ name, items: [], note: "Couldn't load departures." });
          }
        });
        for (const id of ["listings", "stops"]) {
          map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
        }
        setMapError(false);
        setLoaded(true);
      });
    })().catch(() => {
      if (!cancelled) setMapError(true);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      clearTimeout(fallbackTimer);
      mapRef.current?.remove();
      mapRef.current = null;
      // cacheComponents keeps this page alive (React Activity) when you switch tabs: the map
      // is removed here but state survives. Reset it so the next map's "style.load" flips
      // loaded false → true and the data/layer/marker effects run against the new map.
      setLoaded(false);
      framed.current = null;
    };
  }, []);

  // Data → sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    (map.getSource("listings") as GeoJSONSource | undefined)?.setData(listingsGeo);
  }, [loaded, listingsGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    (map.getSource("rings") as GeoJSONSource | undefined)?.setData(ringsGeoJson(destinations));
  }, [loaded, destinations]);

  // Layer visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const vis = (id: string, on: boolean) =>
      map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("luas", layers.luas);
    vis("bus", layers.bus);
    vis("stops", layers.stops);
    vis("rings", layers.rings);
    vis("rings-label", layers.rings);
    vis("listings", layers.listings);
    vis("listings-label", layers.listings);
  }, [loaded, layers]);

  // Destination markers (draggable in settings).
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    let cancelled = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = destinations.map((d) => {
        const el = document.createElement("div");
        el.className =
          "flex items-center gap-1 rounded-full border-2 border-white bg-indigo-600 px-2 py-1 text-xs font-semibold text-white shadow-lg";
        el.textContent = `${d.emoji} ${d.short_name}`;
        el.title = editDestinations ? `${d.name}: drag to move` : d.name;
        const marker = new maplibregl.Marker({ element: el, draggable: editDestinations })
          .setLngLat([d.lng, d.lat])
          .addTo(map);
        if (editDestinations) {
          marker.on("dragend", () => {
            const p = marker.getLngLat();
            void updateDestination(d.id, {
              lat: Number(p.lat.toFixed(6)),
              lng: Number(p.lng.toFixed(6)),
            });
          });
        }
        return marker;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, destinations, editDestinations]);

  const lat = selected?.listing.lat;
  const lng = selected?.listing.lng;
  const located = selected?.assessment.distance != null;
  useEffect(() => {
    if (loaded && focus && located && lat != null && lng != null) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 450 });
    }
  }, [loaded, focus, located, lat, lng]);

  useEffect(() => {
    const frame = [mode, onlyNew, runId].join("/");
    if (!loaded || editDestinations || searchLoading || searchError || framed.current === frame) return;
    framed.current = frame;
    if (focus) return;
    const campus = campusPoint(destinations);
    const points = [
      ...ring(campus.lng, campus.lat, 5),
      ...listingsGeo.features.map((f) => f.geometry.coordinates),
    ];
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    mapRef.current?.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { padding: 48, duration: 0 },
    );
  }, [loaded, mode, focus, listingsGeo, destinations, editDestinations, onlyNew, runId, searchLoading, searchError]);

  async function decide(action: "shortlisted" | "applied" | "hide") {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const ok =
        action === "hide"
          ? await hide(selected.listing.id)
          : await setStage(selected.listing.id, action);
      if (ok) {selectListing(reviewing ? nextRow?.listing.id ?? null : null); setOverlap([]); }
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!focus) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") selectListing(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [focus]);

  const legend = Object.entries(routeIndex).filter(([, v]) => v.kind === "bus");

  return (
    <div className={`relative w-full ${heightClass}`}>
      <div ref={container} className="h-full w-full" data-testid="map" />
      <div className="paper-note bg-background/95 absolute top-2 left-2 z-10 max-h-[65%] max-w-[calc(100%-4rem)] overflow-y-auto rounded-xl border p-3 text-xs shadow-md sm:w-72">
        {!editDestinations && (
          <>
            <h1 className="mb-1">Rental map</h1>
            <p className="text-muted-foreground mb-2">
              5 km from UCD · under €{search.maxPerPerson.toLocaleString("en-IE")}/person
            </p>
            <div className="flex items-center gap-2">
              <select
                aria-label="Listings shown"
                className="bg-background rounded border px-2 py-2"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                }}
              >
                <option value="matches">Matches</option>
                <option value="all">All found</option>
                <option value="unreviewed">Unreviewed</option>
                <option value="checking">Needs checking</option>
                <option value="liked">I like these</option>
                <option value="maybe">Maybe</option>
                <option value="applied">Applied</option>
              </select>
              <button
                className="rounded border px-2 py-2"
                aria-expanded={browse}
                onClick={() => {
                  setBrowse(!browse);
                  setOverlap([]);
                }}
              >
                {visibleRows.length} listings
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={onlyNew} onChange={(e) => setMode(mode, e.target.checked)} />
              {searchRun ? "New in this search" : "New in latest search"}
            </label>
            {searchLoading && <p role="status">Loading search results…</p>}
            {searchError && <p role="alert">{searchError}</p>}
            {!searchLoading && !searchError && !visibleRows.length && (
              <p className="py-2">
                No listings in this view.
                {(mode !== "all" || onlyNew) && (
                  <button className="ml-1 underline" onClick={() => setMode("all", false)}>
                    See all listings
                  </button>
                )}
              </p>
            )}
            {visibleRows.some((r) => r.assessment.distance == null) && (
              <button
                className="block pt-2 underline"
                onClick={() => {
                  setOverlap(
                    visibleRows
                      .filter((r) => r.assessment.distance == null)
                      .map((r) => r.listing.id),
                  );
                  setBrowse(true);
                }}
              >
                Check location ·{" "}
                {visibleRows.filter((r) => r.assessment.distance == null).length} listings
              </button>
            )}
            {mapError && (
              <p role="status">Map unavailable. Open the listings above to keep browsing.</p>
            )}
            {focus && !selected && !busy && (
              <p role="status">
                This listing is hidden or unavailable.{" "}
                <button className="underline" onClick={() => selectListing(null)}>
                  Dismiss
                </button>
              </p>
            )}
            <p className="text-muted-foreground mt-2">● Unopened · {reviewing ? "Newest first" : "Best matches first"}</p>
            {reviewing && !selected && visibleRows.length > 0 && (
              <button className="mt-2 underline" onClick={() => selectListing(visibleRows[0].listing.id)}>
                Review listings
              </button>
            )}
            {browse && (
              <div className="mt-2 max-h-52 overflow-auto border-t">
                {visibleRows
                  .filter((r) => !overlap.length || overlap.includes(r.listing.id))
                  .map((r) => (
                    <button
                      className="block w-full border-b py-2 text-left"
                      key={r.listing.id}
                      onClick={() => {
                        setBrowse(false);
                        setOverlap([]);
                        selectListing(r.listing.id);
                      }}
                    >
                      {!seen.includes(r.listing.id) && "● "}
                      {r.listing.title}
                      <span className="text-muted-foreground block">
                        {rentText(r.listing)} ·{" "}
                        {r.assessment.distance == null
                          ? "Location unconfirmed"
                          : (r.assessment.distance / 1000).toFixed(1) + " km"}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer">Travel options</summary>
          {(
            [
              ["luas", "Luas Green Line"],
              ["bus", "Bus routes to UCD / Sandyford"],
              ["stops", "Stops (zoom in)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 py-0.5">
              <input
                type="checkbox"
                className="accent-primary"
                checked={layers[k]}
                onChange={(e) => setLayers((s) => ({ ...s, [k]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
          {layers.bus && legend.length > 0 && (
            <div className="mt-2 border-t pt-1">
              <div className="mb-0.5 font-semibold">Bus routes</div>
              {legend.map(([name, v]) => (
                <div
                  key={name}
                  className="flex items-center gap-1.5"
                  title={`${v.longName} (${v.operator})`}
                >
                  <span className="inline-block h-1 w-4 rounded" style={{ background: v.colour }} />
                  <span className="font-medium">{name}</span>
                  <span className="text-muted-foreground truncate">{v.serves.join(" + ")}</span>
                </div>
              ))}
            </div>
          )}
        </details>
        {editDestinations && (
          <p className="text-muted-foreground mt-2 border-t pt-1">
            Drag the 🎓 / 💼 pins to the building you actually use.
          </p>
        )}
      </div>

      {departures && (
        <div className="bg-background/95 absolute right-2 bottom-2 z-10 w-64 rounded-lg border p-2 text-xs shadow-md">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">{departures.name}</span>
            <button
              className="text-muted-foreground"
              onClick={() => setDepartures(null)}
              aria-label="Close departures"
            >
              ✕
            </button>
          </div>
          {departures.items.map((d, i) => (
            <div key={i} className="flex justify-between tabular-nums">
              <span className="font-medium">{d.route}</span>
              <span>
                {d.inMinutes != null ? `${d.inMinutes} min` : "—"}
                {d.delayMin ? ` (${d.delayMin > 0 ? "+" : ""}${d.delayMin})` : ""}
              </span>
            </div>
          ))}
          {departures.note && <p className="text-muted-foreground">{departures.note}</p>}
        </div>
      )}

      {overlap.length > 1 && !browse && !editDestinations && (
        <section
          aria-label="Choose a home"
          className="paper-note absolute top-1/2 left-2 z-30 max-h-[36%] w-72 max-w-[90%] -translate-y-1/2 overflow-y-auto p-3"
        >
          <div className="flex items-center justify-between">
            <h2>Homes at this pin</h2>
            <button aria-label="Close homes at this pin" onClick={() => setOverlap([])}>
              ✕
            </button>
          </div>
          {visibleRows
            .filter((r) => overlap.includes(r.listing.id))
            .map((r, i) => (
              <button
                key={r.listing.id}
                aria-pressed={focus === r.listing.id}
                className="aria-pressed:bg-muted block w-full border-t py-2 text-left text-sm"
                onClick={() => selectListing(r.listing.id)}
              >
                <strong>
                  {!seen.includes(r.listing.id) && "● "}Home {i + 1}
                </strong>{" "}
                · {rentText(r.listing)} · {bedsText(r.listing)}
                <span className="block">{r.listing.title}</span>
              </button>
            ))}
        </section>
      )}
      {selected && !editDestinations && (
        <aside
          aria-label="Selected listing"
          className="paper-note bg-background absolute inset-x-2 bottom-2 z-20 max-h-[43%] overflow-y-auto rounded-xl border shadow-lg sm:left-auto sm:w-96"
        >
          <div className="flex items-start justify-between gap-2 p-4 pb-2">
            <h2 className="font-semibold">{selected.listing.title}</h2>
            <button
              className="shrink-0 rounded border px-2 py-1 text-xs"
              onClick={() => selectListing(null)}
            >
              Close
            </button>
          </div>
          <div className="space-y-3 px-4 pb-5">
            <div className="flex items-center gap-3">
              {selected.listing.image_cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.listing.image_cover}
                  alt=""
                  referrerPolicy="origin"
                  className="size-16 rounded-md object-cover"
                />
              )}
              <div>
                <strong>{rentText(selected.listing)}</strong> · {bedsText(selected.listing)}
                <p>
                  {selected.assessment.rent == null
                    ? "Price needs checking"
                    : "€" +
                      selected.assessment.rent.toLocaleString("en-IE", {
                        maximumFractionDigits: 2,
                      }) +
                      " per person / month"}
                </p>
                <p>
                  {selected.assessment.distance == null
                    ? "Location unconfirmed"
                    : (selected.assessment.distance / 1000).toFixed(2) + " km from UCD"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                aria-pressed={myVote > 0}
                className={myVote > 0 ? "border-[#e11d74] bg-[#e11d74] text-white hover:bg-[#c0175f] hover:text-white" : ""}
                onClick={() => void vote(selected.listing.id, myVote > 0 ? 0 : 1)}
              >
                {myVote > 0 ? "♥ Liked" : "♡ I like this"}
              </Button>
              <Button
                disabled={busy}
                variant={selected.pipeline?.stage === "shortlisted" ? "default" : "outline"}
                onClick={() => decide("shortlisted")}
              >
                Maybe
              </Button>
              <Button
                disabled={busy}
                variant={selected.pipeline?.stage === "applied" ? "default" : "outline"}
                onClick={() => decide("applied")}
              >
                Applied
              </Button>
              <Button
                disabled={busy}
                variant="outline"
                title="Hide this listing for everyone"
                onClick={() => decide("hide")}
              >
                Don’t like · hide
              </Button>
            </div>
            {isLiked(selected) && (
              <p className="text-sm font-medium text-[#e11d74]">
                ♥ Liked by{" "}
                {selected.votes
                  .filter((v) => v.value > 0)
                  .map((v) => members.find((m) => m.id === v.member_id)?.display_name ?? "someone")
                  .join(", ")}
              </p>
            )}
            <div className="flex gap-5 text-sm underline">
              {reviewing && <button onClick={() => selectListing(nextRow?.listing.id ?? null)}>
                {nextRow ? "Next listing" : "Finish review"}
              </button>}
              <Link href={`/listing/${selected.listing.id}`}>Full details</Link>
              <a href={selected.listing.url} target="_blank" rel="noopener noreferrer">
                Open on Daft ↗
              </a>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
