"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useDestinations, useMembers, useRows, useSearchSettings, type Row } from "@/lib/store/hooks";
import { groupSizeTable, formatEuro } from "@/lib/budget";
import { memberMinutes } from "@/lib/scoring";
import { Voters, bedsText, rentText, useNow } from "./bits";

type Cell = { node: React.ReactNode; value?: number | null };
type Better = "low" | "high";

/** Highlight the best value in each row. */
function bestIndex(cells: Cell[], better?: Better): number[] {
  if (!better) return [];
  const vals = cells.map((c) => c.value).filter((v): v is number => v != null);
  if (vals.length < 2) return [];
  const target = better === "low" ? Math.min(...vals) : Math.max(...vals);
  if (vals.every((v) => v === target)) return [];
  return cells.map((c, i) => (c.value === target ? i : -1)).filter((i) => i >= 0);
}

export function CompareView() {
  const params = useSearchParams();
  const ids = (params.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter(Boolean)
    .slice(0, 4);
  const all = useRows();
  const destinations = useDestinations();
  const members = useMembers();
  const search = useSearchSettings();
  const now = useNow();
  const rows = useMemo(() => ids.map((id) => all.find((r) => r.listing.id === id)).filter((r): r is Row => !!r), [all, ids]);

  if (rows.length < 2) {
    return (
      <div className="mx-auto max-w-md p-6 text-center text-sm">
        <p className="font-medium">Pick 2–4 listings to compare</p>
        <p className="text-muted-foreground">Tick “Compare” on listing cards in the Inbox or Shortlist.</p>
        <Link href="/inbox" className="text-primary mt-3 inline-block underline">
          Go to Inbox
        </Link>
      </div>
    );
  }

  const sizes: number[] = [];
  for (let n = search.groupSizeMin; n <= search.groupSizeMax; n++) sizes.push(n);
  const days = (r: Row) => Math.floor((now.getTime() - new Date(r.listing.published_at ?? r.listing.first_seen_at).getTime()) / 864e5);

  const spec: { label: string; better?: Better; cells: (r: Row) => Cell }[] = [
    {
      label: "Photo",
      cells: (r) => ({
        // eslint-disable-next-line @next/next/no-img-element
        node: r.listing.image_cover ? <img src={r.listing.image_cover} alt="" className="h-24 w-full rounded object-cover" referrerPolicy="origin" /> : "—",
      }),
    },
    { label: "Score", better: "high", cells: (r) => ({ node: r.score.total, value: r.score.total }) },
    { label: "Rent / month", better: "low", cells: (r) => ({ node: rentText(r.listing), value: r.listing.monthly_rent }) },
    { label: "Per person (beds)", better: "low", cells: (r) => ({ node: r.perPerson != null ? formatEuro(r.perPerson) : "—", value: r.perPerson }) },
    ...sizes.map((n) => ({
      label: `Per person if ${n} of us`,
      better: "low" as Better,
      cells: (r: Row) => {
        const c = groupSizeTable(r.listing, search.maxPerPerson, { min: n, max: n })[0];
        return {
          node: (
            <span className={cn("rounded px-1", c.fits && "bg-emerald-500/20 font-medium text-emerald-800 dark:text-emerald-200")}>
              {c.perPerson != null ? formatEuro(c.perPerson) : c.roomsOk ? "—" : "too few rooms"}
            </span>
          ),
          value: c.fits ? c.perPerson : null,
        };
      },
    })),
    { label: "Beds / baths", better: "high", cells: (r) => ({ node: bedsText(r.listing), value: r.listing.beds ?? r.listing.beds_max }) },
    { label: "Type · area", cells: (r) => ({ node: `${r.listing.property_type ?? "?"} · ${r.listing.area ?? "?"}` }) },
    ...destinations.flatMap((d) => [
      {
        label: `${d.short_name} transit`,
        better: "low" as Better,
        cells: (r: Row) => {
          const c = r.commutes.find((x) => x.destination_id === d.id && x.mode === "transit");
          return {
            node: c ? (
              <span>
                {c.source === "estimate" ? "~" : ""}
                {c.minutes}m{c.transfers != null ? ` · ${c.transfers}×` : ""}
                {c.lines.length ? <span className="text-muted-foreground block text-xs">{c.lines.join(" → ")}</span> : null}
              </span>
            ) : (
              "—"
            ),
            value: c?.minutes ?? null,
          };
        },
      },
      {
        label: `${d.short_name} cycle`,
        better: "low" as Better,
        cells: (r: Row) => {
          const c = r.commutes.find((x) => x.destination_id === d.id && x.mode === "bicycle");
          return { node: c ? `${c.source === "estimate" ? "~" : ""}${c.minutes}m` : "—", value: c?.minutes ?? null };
        },
      },
      {
        label: `${d.short_name} best`,
        better: "low" as Better,
        cells: (r: Row) => {
          const t = memberMinutes(r.commutes, d.id, "best");
          return { node: t != null ? `${t}m` : "—", value: t };
        },
      },
    ]),
    { label: "Votes", better: "high", cells: (r) => ({ node: <Voters votes={r.votes} members={members} />, value: r.votes.reduce((a, v) => a + v.value, 0) }) },
    { label: "Notes", cells: (r) => ({ node: r.notes.length ? <span className="text-xs">{r.notes.map((n) => n.body).join(" · ").slice(0, 160)}</span> : "—" }) },
    { label: "Days on market", better: "low", cells: (r) => ({ node: days(r), value: days(r) }) },
    { label: "Agent", cells: (r) => ({ node: r.listing.seller_name ?? "—" }) },
    { label: "Stage", cells: (r) => ({ node: <span className="capitalize">{(r.pipeline?.stage ?? "new").replace("_", " ")}</span> }) },
  ];

  return (
    <div className="space-y-3 px-3 pt-3 pb-28">
      <h1 className="text-lg font-semibold">Compare</h1>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="w-36 p-2 text-left text-xs font-medium" />
              {rows.map((r) => (
                <th key={r.listing.id} className="p-2 text-left align-top text-xs font-semibold">
                  <Link href={`/listing/${r.listing.id}`} className="hover:underline">
                    {r.listing.title}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.map((row) => {
              const cells = rows.map((r) => row.cells(r));
              const best = bestIndex(cells, row.better);
              return (
                <tr key={row.label} className="border-t">
                  <th className="text-muted-foreground p-2 text-left align-top text-xs font-medium">{row.label}</th>
                  {cells.map((c, i) => (
                    <td key={i} className={cn("p-2 align-top tabular-nums", best.includes(i) && "bg-emerald-500/10 font-semibold")}>
                      {c.node}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">Green = best in row. “~” = estimated commute.</p>
    </div>
  );
}
