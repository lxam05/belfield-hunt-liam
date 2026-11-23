/** Editable defaults (mirrored by the `settings` table column defaults). */

export const GROUP_ID = "00000000-0000-4000-8000-000000000001";

const LEGACY_LOCATION_SLUGS = [
  "dublin-4-dublin",
  "dublin-6-dublin",
  "dublin-14-dublin",
  "dublin-18-dublin",
  "stillorgan-dublin",
  "mount-merrion-dublin",
  "booterstown-dublin",
  "blackrock-dublin",
  "dublin-16-dublin",
] as const;

export const DEFAULT_LOCATION_SLUGS = ["dublin"] as const;

export interface ScoreWeights {
  affordability: number;
  commute: number;
  freshness: number;
  beds: number;
  votes: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  affordability: 30,
  commute: 35,
  freshness: 15,
  beds: 5,
  votes: 15,
};

export interface SearchSettings {
  maxPerPerson: number;
  bedsMin: number;
  bedsMax: number;
  groupSizeMin: number;
  groupSizeMax: number;
  locationSlugs: string[];
  fastLaneCron: string;
  sweepCron: string;
  fastLaneResultsWanted: number;
  sweepResultsWanted: number;
}

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  maxPerPerson: 1300,
  bedsMin: 2,
  bedsMax: 5,
  groupSizeMin: 2,
  groupSizeMax: 5,
  locationSlugs: [...DEFAULT_LOCATION_SLUGS],
  fastLaneCron: "*/30 7-22 * * *",
  sweepCron: "30 3 * * *",
  fastLaneResultsWanted: 10,
  sweepResultsWanted: 300,
};

export const ACTOR_ID = "shahidirfan/Daft-ie-Property-Scraper";
export const FAST_LANE_TASK_NAME = "belfield-fast-lane";
export const SWEEP_TASK_NAME = "belfield-nightly-sweep";
export const TIMEZONE = "Europe/Dublin";
/** A listing missing from this many consecutive sweeps is marked possibly_gone. */
export const MISSED_SWEEPS_THRESHOLD = 3;

/** Settings row (snake_case, as stored) → SearchSettings. */
export function toSearchSettings(
  row: Partial<Record<string, unknown>> | null | undefined,
): SearchSettings {
  const d = DEFAULT_SEARCH_SETTINGS;
  const r = row ?? {};
  const num = (k: string, fb: number) => (typeof r[k] === "number" ? (r[k] as number) : fb);
  return {
    maxPerPerson: Math.min(num("max_per_person", d.maxPerPerson), d.maxPerPerson),
    bedsMin: num("beds_min", d.bedsMin),
    bedsMax: num("beds_max", d.bedsMax),
    groupSizeMin: num("group_size_min", d.groupSizeMin),
    groupSizeMax: num("group_size_max", d.groupSizeMax),
    locationSlugs:
      Array.isArray(r.daft_location_slugs) && r.daft_location_slugs.length > 0 && JSON.stringify(r.daft_location_slugs) !== JSON.stringify(LEGACY_LOCATION_SLUGS)
        ? (r.daft_location_slugs as string[])
        : d.locationSlugs,
    fastLaneCron: typeof r.fast_lane_cron === "string" ? r.fast_lane_cron : d.fastLaneCron,
    sweepCron: typeof r.sweep_cron === "string" ? r.sweep_cron : d.sweepCron,
    fastLaneResultsWanted: num("fast_lane_results_wanted", d.fastLaneResultsWanted),
    sweepResultsWanted: num("sweep_results_wanted", d.sweepResultsWanted),
  };
}
