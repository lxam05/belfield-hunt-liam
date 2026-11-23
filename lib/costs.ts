/**
 * Cost model. Prices verified Nov 2026 (see docs/COSTS.md for sources):
 * - Apify Actor (pay per event): $0.001 / result + $0.0005 / Actor start (per GB memory).
 * - Google Routes "Compute Routes Essentials": 10,000 free / month, then $5.00 / 1000.
 * - Google Geocoding (Essentials): 10,000 free / month, then $5.00 / 1000.
 */
export const APIFY_PRICE_PER_RESULT = 0.001;
export const APIFY_PRICE_PER_START = 0.0005; // 1024 MB → one start event
export const APIFY_COMPUTE_PER_RUN_FAST = 0.001; // ~4 s, ~0.0012 CU observed
export const APIFY_COMPUTE_PER_RUN_SWEEP = 0.01;

export const GOOGLE_SKUS = {
  geocoding: { label: "Geocoding (Essentials)", freeCap: 10_000, per1000: 5 },
  routes: { label: "Compute Routes (Essentials)", freeCap: 10_000, per1000: 5 },
} as const;
export type GoogleSku = keyof typeof GOOGLE_SKUS;

export function apifyRunCost(results: number, kind: "fast_lane" | "nightly_sweep" | string): number {
  const compute = kind === "nightly_sweep" ? APIFY_COMPUTE_PER_RUN_SWEEP : APIFY_COMPUTE_PER_RUN_FAST;
  return results * APIFY_PRICE_PER_RESULT + APIFY_PRICE_PER_START + compute;
}

export function googleCost(sku: GoogleSku, count: number): number {
  const s = GOOGLE_SKUS[sku];
  return (Math.max(0, count - s.freeCap) / 1000) * s.per1000;
}

/** Count of fast-lane runs per day for a "*\/N h1-h2 * * *" cron (fallback: 32). */
export function runsPerDay(cron: string): number {
  const m = cron.trim().match(/^(\*\/(\d+)|0|\d+(?:,\d+)*)\s+(\*|(\d+)-(\d+))\s/);
  if (!m) return 32;
  const perHour = m[2] ? Math.floor(60 / Number(m[2])) : m[1] === "0" ? 1 : m[1].split(",").length;
  const hours = m[3] === "*" ? 24 : Number(m[5]) - Number(m[4]) + 1;
  return perHour * hours;
}

export interface CadenceRow {
  label: string;
  cron: string;
  runsPerDay: number;
  fastMonthly: number;
  withSweepMonthly: number;
}

export const SWEEP_MONTHLY_ESTIMATE = 4.6; // ≈ 150 results/night × 30 + starts + compute

export function cadenceTable(resultsPerRun = 10): CadenceRow[] {
  const rows: [string, string][] = [
    ["every 15 min", "*/15 7-22 * * *"],
    ["every 20 min", "*/20 7-22 * * *"],
    ["every 30 min (default)", "*/30 7-22 * * *"],
    ["hourly", "0 7-23 * * *"],
  ];
  return rows.map(([label, cron]) => {
    const rpd = runsPerDay(cron);
    const fast = rpd * 30 * apifyRunCost(resultsPerRun, "fast_lane");
    return { label, cron, runsPerDay: rpd, fastMonthly: fast, withSweepMonthly: fast + SWEEP_MONTHLY_ESTIMATE };
  });
}
