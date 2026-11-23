"use client";

import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getState, setState } from "./store";
import type { ContactChannel, Destination, Member, Pipeline, Settings, Stage, Vote } from "./types";

const sb = () => supabaseBrowser();

function meOrThrow(): Member {
  const me = getState().me;
  if (!me) throw new Error("Not signed in");
  return me;
}

function patchPipeline(listingId: number, patch: Partial<Pipeline>): Pipeline | undefined {
  const prev = getState().pipeline.get(listingId);
  const base: Pipeline = prev ?? {
    listing_id: listingId,
    stage: "new",
    claimed_by: null,
    claimed_at: null,
    next_action_at: null,
    next_action: null,
    viewing_at: null,
    hidden: false,
    hidden_by: null,
    pinned: false,
    manual_rank: null,
    updated_at: new Date().toISOString(),
  };
  setState((s) => ({ pipeline: new Map(s.pipeline).set(listingId, { ...base, ...patch }) }));
  return prev;
}

function restorePipeline(listingId: number, prev: Pipeline | undefined) {
  setState((s) => {
    const m = new Map(s.pipeline);
    if (prev) m.set(listingId, prev);
    else m.delete(listingId);
    return { pipeline: m };
  });
}

export function memberName(id: string | null | undefined): string {
  if (!id) return "";
  return getState().members.find((m) => m.id === id)?.display_name ?? "someone";
}

/** Optimistic claim. The DB (claim_listing + guard trigger) decides the real winner. */
export async function claim(listingId: number): Promise<boolean> {
  const me = meOrThrow();
  const current = getState().pipeline.get(listingId);
  if (current?.claimed_by && current.claimed_by !== me.id) {
    toast.error(`Already claimed by ${memberName(current.claimed_by)}`);
    return false;
  }
  const prev = patchPipeline(listingId, {
    claimed_by: me.id,
    claimed_at: new Date().toISOString(),
    stage: current && !["new", "shortlisted"].includes(current.stage) ? current.stage : "contacting",
  });
  const { data: winner, error } = await sb().rpc("claim_listing", { p_listing_id: listingId });
  if (error || winner !== me.id) {
    restorePipeline(listingId, prev);
    const { data } = await sb().from("pipeline").select("*").eq("listing_id", listingId).maybeSingle();
    if (data) setState((s) => ({ pipeline: new Map(s.pipeline).set(listingId, data) }));
    toast.error(error ? error.message : `Too late, ${memberName(winner as string)} claimed it first`);
    return false;
  }
  toast.success("Claimed. Everyone can see you're on it.");
  return true;
}

export async function unclaim(listingId: number) {
  const prev = patchPipeline(listingId, { claimed_by: null, claimed_at: null });
  const { error } = await sb().rpc("unclaim_listing", { p_listing_id: listingId });
  if (error) {
    restorePipeline(listingId, prev);
    toast.error(error.message);
  }
}

async function updatePipeline(listingId: number, patch: Partial<Pipeline>, okMsg?: string) {
  const prev = patchPipeline(listingId, patch);
  const { error } = await sb().from("pipeline").update(patch).eq("listing_id", listingId);
  if (error) {
    restorePipeline(listingId, prev);
    toast.error(error.message);
    return false;
  }
  if (okMsg) toast.success(okMsg);
  return true;
}

export const setStage = (listingId: number, stage: Stage) => updatePipeline(listingId, { stage });
export const shortlist = (listingId: number) => updatePipeline(listingId, { stage: "shortlisted" }, "Shortlisted");
export const hide = (listingId: number) =>
  updatePipeline(listingId, { hidden: true, hidden_by: getState().me?.id ?? null }, "Hidden for everyone");
export const unhide = (listingId: number) => updatePipeline(listingId, { hidden: false, hidden_by: null });
export const setPinned = (listingId: number, pinned: boolean) => updatePipeline(listingId, { pinned });
export const setManualRank = (listingId: number, manual_rank: number | null) => updatePipeline(listingId, { manual_rank });
export const setViewing = (listingId: number, viewing_at: string | null) =>
  updatePipeline(listingId, { viewing_at, ...(viewing_at ? { stage: "viewing_booked" as Stage } : {}) });
export const setNextAction = (listingId: number, next_action_at: string | null, next_action: string | null) =>
  updatePipeline(listingId, { next_action_at, next_action });

export async function vote(listingId: number, value: -1 | 0 | 1, stars?: number | null) {
  const me = meOrThrow();
  const existing = (getState().votes.get(listingId) ?? []).find((v) => v.member_id === me.id);
  const row: Vote = {
    listing_id: listingId,
    member_id: me.id,
    value: value,
    stars: stars === undefined ? (existing?.stars ?? null) : stars,
    updated_at: new Date().toISOString(),
  };
  setState((s) => {
    const m = new Map(s.votes);
    m.set(listingId, [...(m.get(listingId) ?? []).filter((v) => v.member_id !== me.id), row]);
    return { votes: m };
  });
  const { error } = await sb().from("votes").upsert(row);
  if (error) toast.error(error.message);
}

export async function setStars(listingId: number, stars: number | null) {
  const me = meOrThrow();
  const existing = (getState().votes.get(listingId) ?? []).find((v) => v.member_id === me.id);
  return vote(listingId, (existing?.value ?? 0) as -1 | 0 | 1, stars);
}

export async function addNote(listingId: number, body: string) {
  const me = meOrThrow();
  const text = body.trim();
  if (!text) return;
  const { data, error } = await sb().from("notes").insert({ listing_id: listingId, member_id: me.id, body: text }).select().single();
  if (error) return toast.error(error.message);
  setState((s) => {
    const m = new Map(s.notes);
    m.set(listingId, [...(m.get(listingId) ?? []).filter((n) => n.id !== data.id), data]);
    return { notes: m };
  });
}

export async function deleteNote(listingId: number, id: string) {
  const { error } = await sb().from("notes").delete().eq("id", id);
  if (error) return toast.error(error.message);
  setState((s) => {
    const m = new Map(s.notes);
    m.set(listingId, (m.get(listingId) ?? []).filter((n) => n.id !== id));
    return { notes: m };
  });
}

/** Record a contact and move the pipeline to "contacted" (claiming it if unclaimed). */
export async function logContact(listingId: number, channel: ContactChannel, outcome?: string) {
  const me = meOrThrow();
  const p = getState().pipeline.get(listingId);
  if (!p?.claimed_by) await claim(listingId);
  const { data, error } = await sb()
    .from("contact_log")
    .insert({ listing_id: listingId, member_id: me.id, channel, outcome: outcome ?? null })
    .select()
    .single();
  if (error) return toast.error(error.message);
  setState((s) => {
    const m = new Map(s.contacts);
    m.set(listingId, [...(m.get(listingId) ?? []), data]);
    return { contacts: m };
  });
  const stage = getState().pipeline.get(listingId)?.stage ?? "new";
  if (["new", "shortlisted", "contacting"].includes(stage)) await setStage(listingId, "contacted");
}

export async function updateSettings(patch: Partial<Settings>) {
  const s = getState().settings;
  if (!s) return false;
  setState({ settings: { ...s, ...patch } });
  const { error } = await sb().from("settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("group_id", s.group_id);
  if (error) {
    setState({ settings: s });
    toast.error(error.message);
    return false;
  }
  return true;
}

export async function updateDestination(id: string, patch: Partial<Destination>) {
  const prev = getState().destinations;
  setState({ destinations: prev.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const { error } = await sb().from("destinations").update(patch).eq("id", id);
  if (error) {
    setState({ destinations: prev });
    toast.error(error.message);
    return false;
  }
  return true;
}

export async function updateMember(id: string, patch: Partial<Member>) {
  const prev = getState().members;
  const next = prev.map((m) => (m.id === id ? { ...m, ...patch } : m));
  setState({ members: next, me: next.find((m) => m.id === getState().me?.id) ?? getState().me });
  const { error } = await sb().from("members").update(patch).eq("id", id);
  if (error) {
    setState({ members: prev });
    toast.error(error.message.includes("unique") ? "That Telegram id is already linked to another member" : error.message);
    return false;
  }
  return true;
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export async function scrapeNow() {
  try {
    const r = await postJson("/api/apify/scrape-now");
    toast.success(
      r.mode === "direct"
        ? `Scraped ${r.items} listings (${r.new} new). Commutes are being added now.`
        : "Full search started. New listings appear here in a minute or two.",
    );
  } catch (e) {
    toast.error((e as Error).message);
  }
}

export async function applyToApify(): Promise<string[] | null> {
  try {
    const r = await postJson("/api/apify/provision");
    toast.success("Apify tasks, schedules and webhooks updated");
    return r.log as string[];
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  }
}

export async function recomputeListing(listingId: number) {
  try {
    await postJson("/api/enrich/retry", { listingId, recompute: true });
    toast.success("Recomputed commutes");
  } catch (e) {
    toast.error((e as Error).message);
  }
}

export async function signOut() {
  await sb().auth.signOut();
  // Full reload on purpose: drops all in-memory group data from this tab.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
}
