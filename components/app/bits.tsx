"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ScoreResult } from "@/lib/scoring";
import { scoreColour } from "@/lib/scoring";
import { formatEuro } from "@/lib/budget";
import { formatAgo, minutesAgo } from "@/lib/time";
import type { Commute, Destination, Member, Vote } from "@/lib/store/types";

/** Re-render every minute so "listed X min ago" stays live. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function ScoreBadge({ score, className }: { score: ScoreResult; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-7 min-w-10 items-center justify-center rounded-full px-2 text-sm font-semibold text-white tabular-nums shadow-sm",
          className,
        )}
        style={{ background: scoreColour(score.total) }}
        aria-label={`Score ${score.total} out of 100, show breakdown`}
      >
        {score.total}
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm">
        <div className="mb-2 font-medium">Score {score.total}/100</div>
        <ul className="space-y-1.5">
          {score.parts.map((p) => (
            <li key={p.key} className="grid grid-cols-[1fr_auto] gap-x-2">
              <span>
                {p.label} <span className="text-muted-foreground">(w {p.weight})</span>
              </span>
              <span className="text-right font-medium tabular-nums">+{p.points.toFixed(1)}</span>
              <span className="text-muted-foreground col-span-2 text-xs">{p.detail}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-2 text-xs">Weights are editable in Settings → Ranking.</p>
      </PopoverContent>
    </Popover>
  );
}

export function PerPersonBadge({ perPerson, cap, className }: { perPerson: number | null; cap: number; className?: string }) {
  if (perPerson == null) return <span className={cn("text-muted-foreground text-sm", className)}>— /person</span>;
  const ok = perPerson <= cap;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold tabular-nums",
        ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-red-500/15 text-red-700 dark:text-red-300",
        className,
      )}
      title={ok ? `Within €${cap}/person` : `Over €${cap}/person`}
    >
      {formatEuro(perPerson)}/pp {ok ? "✓" : "✗"}
    </span>
  );
}

/** "listed X min ago": turns red after 2 h (speed matters). */
export function AgeBadge({ iso, now }: { iso: string | null; now: Date }) {
  const m = minutesAgo(iso, now);
  const stale = m != null && m > 120;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        stale ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
      )}
    >
      {formatAgo(iso, now)}
    </span>
  );
}

export function CommuteChips({
  destinations,
  commutes,
  compact,
}: {
  destinations: Destination[];
  commutes: Commute[];
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {destinations.map((d) => {
        const t = commutes.find((c) => c.destination_id === d.id && c.mode === "transit");
        const b = commutes.find((c) => c.destination_id === d.id && c.mode === "bicycle");
        const fmt = (c?: Commute) => (c?.minutes == null ? "?" : `${c.source === "estimate" ? "~" : ""}${c.minutes}m`);
        const title = [
          t ? `Transit ${fmt(t)}${t.transfers != null ? `, ${t.transfers} transfer(s)` : ""}${t.walk_minutes != null ? `, ${t.walk_minutes}m walking` : ""}${t.lines.length ? `, ${t.lines.join(" → ")}` : ""}` : "",
          b ? `Bike ${fmt(b)}` : "",
          t?.source === "estimate" || b?.source === "estimate" ? "(~ = estimate)" : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <span key={d.id} title={title} className="bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs tabular-nums">
            <span className="font-medium">{compact ? d.emoji : d.short_name}</span>
            <span>🚌 {fmt(t)}</span>
            <span aria-hidden>·</span>
            <span>🚲 {fmt(b)}</span>
          </span>
        );
      })}
    </div>
  );
}

export function MemberDot({ member, size = 22 }: { member: Pick<Member, "display_name" | "colour"> | undefined; size?: number }) {
  if (!member) return null;
  const initials = member.display_name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      title={member.display_name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-background"
      style={{ background: member.colour, width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  );
}

export function Voters({ votes, members }: { votes: Vote[]; members: Member[] }) {
  const shown = votes.filter((v) => v.value !== 0 || v.stars != null);
  if (!shown.length) return null;
  return (
    <div className="flex items-center -space-x-1">
      {shown.map((v) => {
        const m = members.find((x) => x.id === v.member_id);
        return (
          <span key={v.member_id} className="relative" title={`${m?.display_name}: ${v.value > 0 ? "👍" : v.value < 0 ? "👎" : ""}${v.stars ? ` ★${v.stars}` : ""}`}>
            <MemberDot member={m} size={20} />
            <span className="absolute -right-1 -bottom-1 text-[10px]">{v.value > 0 ? "👍" : v.value < 0 ? "👎" : "★"}</span>
          </span>
        );
      })}
    </div>
  );
}

export function Stars({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onChange(value === n ? null : n)}
          className={cn("px-0.5 text-lg leading-none", value != null && n <= value ? "text-amber-500" : "text-muted-foreground/40")}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function rentText(l: { monthly_rent: number | null; price_is_from: boolean; price_on_application: boolean }) {
  if (l.price_on_application || l.monthly_rent == null) return "POA";
  return `${l.price_is_from ? "From " : ""}${formatEuro(l.monthly_rent)}`;
}

export function bedsText(l: { beds: number | null; beds_min: number | null; beds_max: number | null; baths: number | null }) {
  const beds = l.beds != null ? `${l.beds} bed` : l.beds_min != null ? `${l.beds_min}–${l.beds_max} bed` : "? bed";
  return `${beds}${l.baths != null ? ` · ${l.baths} bath` : ""}`;
}
