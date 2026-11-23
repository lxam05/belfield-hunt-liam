"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRows, useSearchSettings, useDestinations, useMe, useMembers, type Row } from "@/lib/store/hooks";
import { claim, hide, shortlist, vote } from "@/lib/store/actions";
import { memberMinutes } from "@/lib/scoring";
import { ListingCard } from "./listing-card";
import { useNow } from "./bits";

interface Filters {
  budgetOk: boolean;
  bedsMin: number;
  bedsMax: number;
  maxCommute: Record<string, number>;
  area: string;
  type: string;
  hasPhotos: boolean;
  unclaimed: boolean;
  showHidden: boolean;
  q: string;
  sort: "newest" | "score" | "perPerson";
}

const FILTER_KEY = "belfield-hunt:feed-filters:v1";

function loadFilters(): Partial<Filters> {
  try {
    return JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function Feed() {
  const rows = useRows();
  const search = useSearchSettings();
  const destinations = useDestinations();
  const members = useMembers();
  const me = useMe();
  const now = useNow();
  const router = useRouter();
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => ({
    budgetOk: true,
    bedsMin: 2,
    bedsMax: 5,
    maxCommute: {},
    area: "",
    type: "",
    hasPhotos: false,
    unclaimed: false,
    showHidden: false,
    q: "",
    sort: "newest",
  }));
  const [compare, setCompare] = useState<number[]>([]);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Restore saved filters after mount (avoids hydration mismatch).
    const saved = loadFilters();
    if (Object.keys(saved).length) setFilters((f) => ({ ...f, ...saved, q: "" })); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  const areas = useMemo(() => [...new Set(rows.map((r) => r.listing.area).filter(Boolean))].sort() as string[], [rows]);
  const types = useMemo(() => [...new Set(rows.map((r) => r.listing.property_type).filter(Boolean))].sort() as string[], [rows]);

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const out = rows.filter((r: Row) => {
      const l = r.listing;
      if (!filters.showHidden && r.pipeline?.hidden) return false;
      if (filters.budgetOk && !r.fits) return false;
      const bLo = l.beds ?? l.beds_min;
      const bHi = l.beds ?? l.beds_max;
      if (bHi != null && bHi < filters.bedsMin) return false;
      if (bLo != null && bLo > filters.bedsMax) return false;
      if (filters.area && l.area !== filters.area) return false;
      if (filters.type && l.property_type !== filters.type) return false;
      if (filters.hasPhotos && !l.image_cover) return false;
      if (filters.unclaimed && r.pipeline?.claimed_by) return false;
      for (const [destId, max] of Object.entries(filters.maxCommute)) {
        if (!max) continue;
        const t = memberMinutes(r.commutes, destId, "best");
        if (t != null && t > max) return false;
      }
      if (q && !`${l.title} ${l.area} ${l.seller_name}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const ts = (r: Row) => new Date(r.listing.published_at ?? r.listing.first_seen_at).getTime();
    if (filters.sort === "score") out.sort((a, b) => b.score.total - a.score.total);
    else if (filters.sort === "perPerson") out.sort((a, b) => (a.perPerson ?? 1e9) - (b.perPerson ?? 1e9));
    else out.sort((a, b) => ts(b) - ts(a));
    return out;
  }, [rows, filters]);

  // Desktop keyboard shortcuts: j/k move, c claim, o open on Daft, s shortlist, h hide, u/d vote, enter details.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const r = visible[selected];
      const act: Record<string, () => void> = {
        j: () => setSelected((i) => Math.min(visible.length - 1, i + 1)),
        k: () => setSelected((i) => Math.max(0, i - 1)),
        c: () => r && claim(r.listing.id),
        o: () => r && window.open(r.listing.url, "_blank", "noopener"),
        s: () => r && shortlist(r.listing.id),
        h: () => r && hide(r.listing.id),
        u: () => r && vote(r.listing.id, 1),
        d: () => r && vote(r.listing.id, -1),
        Enter: () => r && router.push(`/listing/${r.listing.id}`),
        "/": () => document.getElementById("feed-search")?.focus(),
      };
      const fn = act[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected, router]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-selected]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleCompare = (id: number) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 4 ? c : [...c, id]));
  const fresh = visible.filter((r) => now.getTime() - new Date(r.listing.first_seen_at).getTime() < 2 * 36e5).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3 pt-3 pb-28 sm:px-4">
      <div className="flex items-center gap-2">
        <Input id="feed-search" value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Search address, area, agent…  ( / )" className="h-9" />
        <Button variant={showFilters ? "secondary" : "outline"} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <SlidersHorizontal /> Filters
        </Button>
      </div>

      {showFilters && (
        <div className="bg-card grid grid-cols-2 gap-3 rounded-xl border p-3 text-sm sm:grid-cols-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-primary size-4" checked={filters.budgetOk} onChange={(e) => set("budgetOk", e.target.checked)} />
            Within 5 km and under €{search.maxPerPerson}/person
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-primary size-4" checked={filters.unclaimed} onChange={(e) => set("unclaimed", e.target.checked)} />
            Not yet claimed
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-primary size-4" checked={filters.hasPhotos} onChange={(e) => set("hasPhotos", e.target.checked)} />
            Has photos
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-primary size-4" checked={filters.showHidden} onChange={(e) => set("showHidden", e.target.checked)} />
            Show hidden
          </label>
          <label className="flex items-center gap-2">
            Beds
            <select className="bg-background rounded border px-1 py-0.5" value={filters.bedsMin} onChange={(e) => set("bedsMin", Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            –
            <select className="bg-background rounded border px-1 py-0.5" value={filters.bedsMax} onChange={(e) => set("bedsMax", Number(e.target.value))}>
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Sort
            <select className="bg-background rounded border px-1 py-0.5" value={filters.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])}>
              <option value="newest">Newest</option>
              <option value="score">Score</option>
              <option value="perPerson">€/person</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Area
            <select className="bg-background min-w-0 flex-1 rounded border px-1 py-0.5" value={filters.area} onChange={(e) => set("area", e.target.value)}>
              <option value="">All</option>
              {areas.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Type
            <select className="bg-background min-w-0 flex-1 rounded border px-1 py-0.5" value={filters.type} onChange={(e) => set("type", e.target.value)}>
              <option value="">All</option>
              {types.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          {destinations.map((d) => (
            <label key={d.id} className="flex items-center gap-2">
              Max to {d.short_name}
              <select
                className="bg-background rounded border px-1 py-0.5"
                value={filters.maxCommute[d.id] ?? 0}
                onChange={(e) => set("maxCommute", { ...filters.maxCommute, [d.id]: Number(e.target.value) })}
              >
                <option value={0}>any</option>
                {[15, 20, 25, 30, 40, 50, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} min
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          {visible.length} listing{visible.length === 1 ? "" : "s"}
          {fresh > 0 && <span className="text-sky-600 dark:text-sky-400"> · {fresh} in the last 2 h</span>}
        </span>
        <span className="hidden sm:inline">j/k move · c claim · o Daft · s shortlist · h hide · u/d vote</span>
      </div>

      <div ref={listRef} className="space-y-3">
        {visible.map((r, i) => (
          <ListingCard
            key={r.listing.id}
            row={r}
            me={me}
            members={members}
            destinations={destinations}
            cap={search.maxPerPerson}
            now={now}
            selected={i === selected}
            compareChecked={compare.includes(r.listing.id)}
            onToggleCompare={toggleCompare}
          />
        ))}
        {visible.length === 0 && (
          <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
            Nothing matches yet. New listings land here within a minute of each scrape.
          </div>
        )}
      </div>

      {compare.length >= 2 && (
        <div className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 sm:bottom-6">
          <Button size="lg" className="shadow-lg" onClick={() => router.push(`/compare?ids=${compare.join(",")}`)}>
            <GitCompare /> Compare {compare.length}
          </Button>
        </div>
      )}
    </div>
  );
}
