import { DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from "@/lib/config/defaults";
import { effectiveBeds, perPersonRent } from "@/lib/budget";

/**
 * Transparent 0–100 score. Each component yields a value in [0, 1]; the total is the
 * weight-normalized sum × 100. The breakdown is shown in a tooltip in the UI.
 */

export interface ScoreListing {
  lat?: number | null;
  geocode_precision?: string | null;
  monthly_rent: number | null;
  beds: number | null;
  beds_min: number | null;
  beds_max: number | null;
  is_development?: boolean;
  published_at: string | null;
  first_seen_at?: string | null;
}

export interface ScoreCommute {
  destination_id: string;
  mode: "transit" | "transit_return" | "bicycle" | "walk";
  minutes: number | null;
}

export interface ScoreDestination {
  lat?: number;
  id: string;
  short_name: string;
  is_intern_site: boolean;
  who_commutes?: string[] | null;
  weight?: number | null;
}

export interface ScoreMember {
  id: string;
  interns_at_sandyford: boolean;
  commute_mode?: string | null;
}

export interface ScoreVote {
  member_id: string;
  value: number;
  stars: number | null;
}

export interface ScoreContext {
  maxPerPerson: number;
  groupSizeMin: number;
  groupSizeMax: number;
  bedsMin: number;
  bedsMax: number;
  weights?: Partial<ScoreWeights>;
  destinations: ScoreDestination[];
  members: ScoreMember[];
  now?: Date;
}

export interface ScorePart {
  key: keyof ScoreWeights;
  label: string;
  weight: number;
  value: number;
  points: number;
  detail: string;
}

export interface ScoreResult {
  total: number;
  parts: ScorePart[];
}

/** Commute minutes → [0, 1]: ≤15 min is perfect, ≥60 min is worthless, linear between. */
export function commuteValue(minutes: number): number {
  return clamp01((60 - minutes) / 45);
}

/** Newer is better (urgency): e^(-hours/36): ~0.95 at 2 h, ~0.5 at 1 day, ~0.14 at 3 days. */
export function freshnessValue(hours: number): number {
  return clamp01(Math.exp(-Math.max(0, hours) / 36));
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

const MODES_FOR_BEST: ScoreCommute["mode"][] = ["transit", "bicycle", "walk"];

/** Time for one member: their preferred mode, else the fastest available. */
export function memberMinutes(
  commutes: ScoreCommute[],
  destinationId: string,
  mode: string | null | undefined,
): number | null {
  const at = commutes.filter((c) => c.destination_id === destinationId && c.minutes != null);
  if (mode && mode !== "best") {
    const m = at.find((c) => c.mode === mode);
    if (m?.minutes != null) return m.minutes;
  }
  const best = at.filter((c) => MODES_FOR_BEST.includes(c.mode)).map((c) => c.minutes as number);
  return best.length ? Math.min(...best) : null;
}

/** Members commuting to each destination (explicit list, else interns → intern site). */
export function commutersFor(dest: ScoreDestination, members: ScoreMember[]): ScoreMember[] {
  if (dest.who_commutes && dest.who_commutes.length > 0) {
    return members.filter((m) => dest.who_commutes!.includes(m.id));
  }
  return members.filter((m) => m.interns_at_sandyford === dest.is_intern_site);
}

export function scoreListing(
  l: ScoreListing,
  commutes: ScoreCommute[],
  votes: ScoreVote[],
  ctx: ScoreContext,
): ScoreResult {
  const w = { ...DEFAULT_SCORE_WEIGHTS, ...(ctx.weights ?? {}) };
  const now = ctx.now ?? new Date();
  const parts: ScorePart[] = [];

  // Affordability: (cap − perPerson) / cap, clamped. Over budget or unknown → 0.
  const pp = perPersonRent(l.monthly_rent, effectiveBeds(l));
  const afford = pp == null ? 0 : clamp01((ctx.maxPerPerson - pp) / ctx.maxPerPerson);
  parts.push({
    key: "affordability",
    label: "Affordability",
    weight: w.affordability,
    value: afford,
    points: 0,
    detail: pp == null ? "No price" : `€${pp}/person vs €${ctx.maxPerPerson} cap`,
  });

  // Commute: per destination, use the worse-off commuter's time; weight by commuter count.
  let commuteNum = 0;
  let commuteDen = 0;
  const details: string[] = [];
  for (const d of ctx.destinations) {
    let people = commutersFor(d, ctx.members);
    // Before anyone joins (or for system scoring), fall back to the destination weight.
    const count =
      people.length > 0 ? people.length : ctx.members.length === 0 ? (d.weight ?? 1) : 0;
    if (count === 0) continue;
    if (people.length === 0)
      people = [{ id: "_", interns_at_sandyford: d.is_intern_site, commute_mode: "best" }];
    const times = people.map((m) => memberMinutes(commutes, d.id, m.commute_mode));
    const known = times.filter((t): t is number => t != null);
    const worst = known.length ? Math.max(...known) : null;
    // No commute data yet: neutral 0.4 so un-enriched listings don't dominate or vanish.
    const v = worst == null ? 0.4 : commuteValue(worst);
    commuteNum += v * count;
    commuteDen += count;
    details.push(`${d.short_name} ${worst == null ? "?" : `${worst}m`} (×${count})`);
  }
  parts.push({
    key: "commute",
    label: "Commute (worst-off member)",
    weight: w.commute,
    value: commuteDen ? commuteNum / commuteDen : 0.4,
    points: 0,
    detail: details.join(" · ") || "No destinations",
  });

  // Freshness.
  const ref = l.published_at ?? l.first_seen_at ?? null;
  const hours = ref ? (now.getTime() - new Date(ref).getTime()) / 3_600_000 : 48;
  parts.push({
    key: "freshness",
    label: "Freshness",
    weight: w.freshness,
    value: freshnessValue(hours),
    points: 0,
    detail:
      hours < 1
        ? `${Math.max(0, Math.round(hours * 60))} min old`
        : hours < 48
          ? `${Math.round(hours)} h old`
          : `${Math.round(hours / 24)} days old`,
  });

  // Bedrooms fit the group size range (and the searched bedroom range).
  const lo = Math.max(ctx.groupSizeMin, ctx.bedsMin);
  const hi = Math.min(ctx.groupSizeMax, ctx.bedsMax);
  let bedsV = 0;
  let bedsDetail = "Unknown bedrooms";
  if (l.beds != null) {
    bedsV = l.beds >= lo && l.beds <= hi ? 1 : 0;
    bedsDetail = `${l.beds} bed ${bedsV ? "fits" : "outside"} ${lo}–${hi}`;
  } else if (l.beds_min != null && l.beds_max != null) {
    bedsV = l.beds_max >= lo && l.beds_min <= hi ? 0.7 : 0;
    bedsDetail = `Development ${l.beds_min}–${l.beds_max} bed`;
  }
  parts.push({
    key: "beds",
    label: "Bedrooms fit",
    weight: w.beds,
    value: bedsV,
    points: 0,
    detail: bedsDetail,
  });

  // Group votes and stars. No votes → neutral 0.5.
  const relevant = votes.filter((v) => v.value !== 0 || v.stars != null);
  let votesV = 0.5;
  let votesDetail = "No votes yet";
  if (relevant.length) {
    const thumbs = relevant.filter((v) => v.value !== 0);
    const stars = relevant.filter((v) => v.stars != null);
    const comps: number[] = [];
    if (thumbs.length)
      comps.push((thumbs.reduce((a, v) => a + v.value, 0) / thumbs.length + 1) / 2);
    if (stars.length)
      comps.push((stars.reduce((a, v) => a + (v.stars as number), 0) / stars.length - 1) / 4);
    votesV = comps.reduce((a, b) => a + b, 0) / comps.length;
    const up = thumbs.filter((v) => v.value > 0).length;
    const down = thumbs.filter((v) => v.value < 0).length;
    votesDetail = `👍${up} 👎${down}${stars.length ? ` ★${(stars.reduce((a, v) => a + (v.stars as number), 0) / stars.length).toFixed(1)}` : ""}`;
  }
  parts.push({
    key: "votes",
    label: "Group votes",
    weight: w.votes,
    value: votesV,
    points: 0,
    detail: votesDetail,
  });

  const totalWeight = parts.reduce((a, p) => a + Math.max(0, p.weight), 0) || 1;
  const workLat = ctx.destinations.find(d => d.is_intern_site)?.lat ?? 53.2705;
  const south = l.lat != null && l.lat < workLat && ["street","rooftop","eircode"].includes(l.geocode_precision ?? "");
  const locationFactor = south ? 0.6 : 1;
  if (south) details.push("South of work: score reduced by 40%");
  if (south) parts.find(p=>p.key==="commute")!.detail = details.join(" · ");
  for (const p of parts)
    p.points = Math.round(((Math.max(0, p.weight) * p.value * locationFactor) / totalWeight) * 1000) / 10;
  const total = Math.round(
    parts.reduce((a, p) => a + (Math.max(0, p.weight) * p.value * locationFactor) / totalWeight, 0) * 100,
  );
  return { total, parts };
}

export function scoreColour(score: number | null | undefined): string {
  if (score == null) return "#9ca3af";
  if (score >= 70) return "#16a34a";
  if (score >= 55) return "#65a30d";
  if (score >= 40) return "#ca8a04";
  if (score >= 25) return "#ea580c";
  return "#dc2626";
}
