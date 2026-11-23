"use client";

import { useMemo } from "react";
import { useStore } from "./store";
import type { Commute, ListingLite, Pipeline, StoreState, Vote, Note, Contact, Destination, Member } from "./types";
import { scoreListing, type ScoreResult } from "@/lib/scoring";
import { effectiveBeds, perPersonRent } from "@/lib/budget";
import { DEFAULT_SCORE_WEIGHTS, toSearchSettings, type ScoreWeights, type SearchSettings } from "@/lib/config/defaults";

import { assessRental, campusPoint } from "@/lib/rental-search";

export interface Row {
  listing: ListingLite;
  pipeline: Pipeline | undefined;
  commutes: Commute[];
  votes: Vote[];
  notes: Note[];
  contacts: Contact[];
  score: ScoreResult;
  perPerson: number | null;
  fits: boolean;
  assessment: ReturnType<typeof assessRental>;
}

export function useSearchSettings(): SearchSettings {
  const settings = useStore((s) => s.settings);
  return useMemo(() => toSearchSettings(settings), [settings]);
}

export function useWeights(): ScoreWeights {
  const settings = useStore((s) => s.settings);
  return useMemo(
    () => ({ ...DEFAULT_SCORE_WEIGHTS, ...((settings?.score_weights as Partial<ScoreWeights> | null) ?? {}) }),
    [settings],
  );
}

export function buildRow(
  s: StoreState,
  l: ListingLite,
  search: SearchSettings,
  weights: ScoreWeights,
  now: Date,
): Row {
  const assessment = assessRental(l, campusPoint(s.destinations), search.maxPerPerson);
  const commutes = s.commutes.get(l.id) ?? [];
  const votes = s.votes.get(l.id) ?? [];
  const score = scoreListing(l, commutes, votes, {
    maxPerPerson: search.maxPerPerson,
    groupSizeMin: search.groupSizeMin,
    groupSizeMax: search.groupSizeMax,
    bedsMin: search.bedsMin,
    bedsMax: search.bedsMax,
    weights,
    destinations: s.destinations,
    members: s.members,
    now,
  });
  return {
    listing: l,
    pipeline: s.pipeline.get(l.id),
    commutes,
    votes,
    notes: s.notes.get(l.id) ?? [],
    contacts: s.contacts.get(l.id) ?? [],
    score,
    perPerson: perPersonRent(l.monthly_rent, effectiveBeds(l)),
    fits: assessment.matches,
    assessment,
  };
}

/** All listings with live scores. Re-computes when any store data changes (cheap: <1k rows). */
export function useRows(): Row[] {
  const version = useStore((s) => s.version);
  const s = useStore((st) => st);
  const search = useSearchSettings();
  const weights = useWeights();
  return useMemo(() => {
    const now = new Date();
    return [...s.listings.values()].map((l) => buildRow(s, l, search, weights, now));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, search, weights]);
}

export function useRow(id: number): Row | null {
  const rows = useRows();
  return useMemo(() => rows.find((r) => r.listing.id === id) ?? null, [rows, id]);
}

export function useMembers(): Member[] {
  return useStore((s) => s.members);
}

export function useDestinations(): Destination[] {
  return useStore((s) => s.destinations);
}

export function useMe(): Member | null {
  return useStore((s) => s.me);
}
