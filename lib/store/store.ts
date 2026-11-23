"use client";

import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Commute, Contact, ListingLite, Note, Pipeline, StoreState, Vote } from "./types";

/**
 * Client-side store for the whole (small) dataset: a few hundred listings plus their
 * commutes, pipeline rows, votes, notes and contacts. Loaded once through RLS, kept live
 * with Supabase Realtime, and snapshotted to localStorage for the offline PWA shell.
 */

const SNAPSHOT_KEY = "belfield-hunt:snapshot:v1";
const LISTING_COLUMNS =
  "id,daft_shortcode,url,raw_url,title,area,suburb,eircode,lat,lng,geocode_precision,monthly_rent,price_text,price_is_from,price_on_application,beds,beds_min,beds_max,baths,property_type,is_development,seller_name,seller_phone,image_cover,images,image_count,has_video,has_virtual_tour,featured_level,published_at,first_seen_at,last_seen_at,last_swept_at,missed_sweeps,status,score,enriched_at";

const initial: StoreState = {
  ready: false,
  error: null,
  offline: false,
  me: null,
  members: [],
  destinations: [],
  settings: null,
  listings: new Map(),
  commutes: new Map(),
  pipeline: new Map(),
  votes: new Map(),
  notes: new Map(),
  contacts: new Map(),
  version: 0,
};

let state: StoreState = initial;
const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p, version: state.version + 1 };
  for (const l of listeners) l();
  scheduleSnapshot();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: StoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initial),
  );
}

// ─── Grouping helpers ──────────────────────────────────────────────────────
function groupBy<R extends { listing_id: number }>(rows: R[]): Map<number, R[]> {
  const m = new Map<number, R[]>();
  for (const r of rows) {
    const arr = m.get(r.listing_id);
    if (arr) arr.push(r);
    else m.set(r.listing_id, [r]);
  }
  return m;
}

function upsertIn<R>(map: Map<number, R[]>, listingId: number, row: R, same: (a: R) => boolean): Map<number, R[]> {
  const next = new Map(map);
  const arr = (next.get(listingId) ?? []).filter((r) => !same(r));
  next.set(listingId, [...arr, row]);
  return next;
}

function removeIn<R>(map: Map<number, R[]>, listingId: number, same: (a: R) => boolean): Map<number, R[]> {
  const next = new Map(map);
  next.set(listingId, (next.get(listingId) ?? []).filter((r) => !same(r)));
  return next;
}

// ─── Loading ───────────────────────────────────────────────────────────────
async function selectAll<R>(q: () => PromiseLike<{ data: R[] | null; error: { message: string } | null }>): Promise<R[]> {
  const { data, error } = await q();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function pages<R>(query: (start: number, end: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>) {
  const rows: R[] = [];
  for (let start = 0; ; start += 500) {
    const page = await selectAll(() => query(start, start + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

let loading: Promise<void> | null = null;

export function loadAll(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    const sb = supabaseBrowser();
    try {
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      const [members, destinations, settings, listings, commutes, pipeline, votes, notes, contacts] = await Promise.all([
        selectAll(() => sb.from("members").select("*").order("created_at")),
        selectAll(() => sb.from("destinations").select("*").order("sort_order")),
        selectAll(() => sb.from("settings").select("*").limit(1)),
        pages((start, end) =>
          sb.from("listings").select(LISTING_COLUMNS).neq("status", "gone").order("first_seen_at", { ascending: false }).order("id").range(start, end),
        ),
        selectAll(() => sb.from("commutes").select("*").limit(10000)),
        pages((start, end) => sb.from("pipeline").select("*").order("listing_id").range(start, end)),
        selectAll(() => sb.from("votes").select("*").limit(10000)),
        selectAll(() => sb.from("notes").select("*").order("created_at").limit(5000)),
        selectAll(() => sb.from("contact_log").select("*").order("at").limit(5000)),
      ]);
      const me = members.find((m) => m.user_id === auth.user!.id) ?? null;
      if (!me) throw new Error("Your account is not a member of this group. Ask an admin to invite you.");
      setState({
        ready: true,
        error: null,
        offline: false,
        me,
        members,
        destinations,
        settings: settings[0] ?? null,
        listings: new Map((listings as unknown as ListingLite[]).map((l) => [l.id, l])),
        commutes: groupBy(commutes),
        pipeline: new Map(pipeline.map((p) => [p.listing_id, p])),
        votes: groupBy(votes),
        notes: groupBy(notes),
        contacts: groupBy(contacts),
      });
      startRealtime();
    } catch (e) {
      const restored = restoreSnapshot();
      setState({
        ready: restored,
        offline: restored && typeof navigator !== "undefined" && !navigator.onLine,
        error: (e as Error).message,
      });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// ─── Realtime ──────────────────────────────────────────────────────────────
let channel: RealtimeChannel | null = null;

type Change<R> = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: R; old: Partial<R> };

function startRealtime() {
  if (channel) return;
  const sb = supabaseBrowser();
  channel = sb
    .channel("belfield-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, (p) => {
      const c = p as unknown as Change<ListingLite & { raw?: unknown }>;
      if (c.eventType === "DELETE") {
        setState((s) => {
          const m = new Map(s.listings);
          m.delete(c.old.id as number);
          return { listings: m };
        });
        return;
      }
      const { raw: _raw, ...row } = c.new;
      void _raw;
      setState((s) => ({ listings: new Map(s.listings).set(row.id, { ...s.listings.get(row.id), ...row }) }));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "pipeline" }, (p) => {
      const c = p as unknown as Change<Pipeline>;
      if (c.eventType === "DELETE") return;
      setState((s) => ({ pipeline: new Map(s.pipeline).set(c.new.listing_id, c.new) }));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, (p) => {
      const c = p as unknown as Change<Vote>;
      if (c.eventType === "DELETE") {
        const o = c.old as Vote;
        setState((s) => ({ votes: removeIn(s.votes, o.listing_id, (v) => v.member_id === o.member_id) }));
        return;
      }
      setState((s) => ({ votes: upsertIn(s.votes, c.new.listing_id, c.new, (v) => v.member_id === c.new.member_id) }));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, (p) => {
      const c = p as unknown as Change<Note>;
      if (c.eventType === "DELETE") {
        const id = c.old.id;
        setState((s) => {
          const next = new Map(s.notes);
          for (const [k, arr] of next) next.set(k, arr.filter((n) => n.id !== id));
          return { notes: next };
        });
        return;
      }
      setState((s) => ({ notes: upsertIn(s.notes, c.new.listing_id, c.new, (n) => n.id === c.new.id) }));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "commutes" }, (p) => {
      const c = p as unknown as Change<Commute>;
      if (c.eventType === "DELETE") return;
      setState((s) => ({
        commutes: upsertIn(s.commutes, c.new.listing_id, c.new, (x) => x.destination_id === c.new.destination_id && x.mode === c.new.mode),
      }));
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "contact_log" }, (p) => {
      const c = p as unknown as Change<Contact>;
      setState((s) => ({ contacts: upsertIn(s.contacts, c.new.listing_id, c.new, (x) => x.id === c.new.id) }));
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Reconnect with a full reload so nothing is missed while disconnected.
        channel = null;
        setTimeout(() => void loadAll(true), 3000);
      }
    });

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => void loadAll(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad > 5 * 60_000) void loadAll(true);
    });
  }
}
let lastLoad = Date.now();

// ─── Offline snapshot ──────────────────────────────────────────────────────
let snapTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSnapshot() {
  if (typeof window === "undefined" || !state.ready || state.offline) return;
  lastLoad = Date.now();
  if (snapTimer) clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    try {
      const listings = [...state.listings.values()]
        .sort((a, b) => (b.first_seen_at > a.first_seen_at ? 1 : -1))
        .slice(0, 300);
      const ids = new Set(listings.map((l) => l.id));
      const pick = <R,>(m: Map<number, R[]>) => [...m.entries()].filter(([k]) => ids.has(k));
      const snap = {
        at: Date.now(),
        me: state.me,
        members: state.members,
        destinations: state.destinations,
        settings: state.settings,
        listings,
        commutes: pick(state.commutes),
        pipeline: [...state.pipeline.entries()].filter(([k]) => ids.has(k)),
        votes: pick(state.votes),
        notes: pick(state.notes),
        contacts: pick(state.contacts),
      };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    } catch {
      /* quota exceeded or private mode: offline view just won't be available */
    }
  }, 1500);
}

function restoreSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    state = {
      ...state,
      me: s.me,
      members: s.members,
      destinations: s.destinations,
      settings: s.settings,
      listings: new Map((s.listings as ListingLite[]).map((l) => [l.id, l])),
      commutes: new Map(s.commutes),
      pipeline: new Map(s.pipeline),
      votes: new Map(s.votes),
      notes: new Map(s.notes),
      contacts: new Map(s.contacts),
    };
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}
