import { TIMEZONE } from "@/lib/config/defaults";

/** Parts of a date as seen in Europe/Dublin. */
function dublinParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: p.weekday as string,
  };
}

/** 'YYYY-MM' in Europe/Dublin, used as the usage-counter bucket. */
export function monthKey(d: Date = new Date()): string {
  const p = dublinParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function dublinDateKey(d: Date = new Date()): string {
  const p = dublinParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset of Europe/Dublin from UTC at instant d, in minutes (0 in winter, 60 in summer). */
export function dublinOffsetMinutes(d: Date): number {
  const p = dublinParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** Wall-clock time in Dublin → UTC Date. */
export function dublinWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off = dublinOffsetMinutes(guess);
  const adjusted = new Date(guess.getTime() - off * 60000);
  // Re-check across a DST boundary.
  const off2 = dublinOffsetMinutes(adjusted);
  return off2 === off ? adjusted : new Date(guess.getTime() - off2 * 60000);
}

/**
 * Next weekday (Mon–Fri) at hh:mm Dublin time, strictly in the future. Used as the Routes
 * departure/arrival time: a fixed future time avoids "now" (real-time traffic, pricier SKU).
 */
export function nextWeekdayAt(hour: number, minute: number, from: Date = new Date()): Date {
  const start = dublinParts(from);
  for (let i = 0; i < 8; i++) {
    const base = new Date(Date.UTC(start.year, start.month - 1, start.day + i, 12));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    const wd = base.getUTCDay(); // calendar weekday of that Dublin date
    if (wd === 0 || wd === 6) continue;
    const candidate = dublinWallTimeToUtc(y, m, d, hour, minute);
    if (candidate.getTime() > from.getTime() + 60_000) return candidate;
  }
  throw new Error("unreachable");
}

export function minutesAgo(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
}

export function formatAgo(iso: string | null | undefined, now: Date = new Date()): string {
  const m = minutesAgo(iso, now);
  if (m == null) return "—";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}
