"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Lock, LockOpen, Pin, PinOff, GitCompare } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRows, useSearchSettings, type Row } from "@/lib/store/hooks";
import { setManualRank, setPinned } from "@/lib/store/actions";
import { PerPersonBadge, ScoreBadge, rentText, bedsText } from "./bits";

/**
 * Ranked shortlist. Order: pinned first, then rows with a locked manual rank at that position,
 * then everything else by live score. Pins and locks are shared with the whole group.
 */
export function rankRows(rows: Row[]): Row[] {
  const pinned = rows.filter((r) => r.pipeline?.pinned).sort((a, b) => b.score.total - a.score.total);
  const rest = rows.filter((r) => !r.pipeline?.pinned);
  const locked = rest.filter((r) => r.pipeline?.manual_rank != null).sort((a, b) => a.pipeline!.manual_rank! - b.pipeline!.manual_rank!);
  const free = rest.filter((r) => r.pipeline?.manual_rank == null).sort((a, b) => b.score.total - a.score.total);
  const out = [...free];
  for (const r of locked) {
    const pos = Math.max(0, Math.min(out.length, r.pipeline!.manual_rank! - 1));
    out.splice(pos, 0, r);
  }
  return [...pinned, ...out];
}

export function ShortlistView() {
  const rows = useRows();
  const search = useSearchSettings();
  const router = useRouter();
  const [compare, setCompare] = useState<number[]>([]);
  const shortlisted = useMemo(
    () => rankRows(rows.filter((r) => r.pipeline && !["new", "rejected", "gone"].includes(r.pipeline.stage) && !r.pipeline.hidden)),
    [rows],
  );
  const pinnedCount = shortlisted.filter((r) => r.pipeline?.pinned).length;

  function move(r: Row, delta: number) {
    const idx = shortlisted.indexOf(r);
    const target = Math.max(1, idx + 1 + delta - pinnedCount);
    void setManualRank(r.listing.id, target);
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3 pt-3 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Shortlist</h1>
        {compare.length >= 2 && (
          <Button size="sm" onClick={() => router.push(`/compare?ids=${compare.join(",")}`)}>
            <GitCompare /> Compare {compare.length}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">Ranked by live score. 📌 Pin to keep at the top; ↑/↓ locks a manual position for everyone.</p>
      <ol className="space-y-2">
        {shortlisted.map((r, i) => {
          const p = r.pipeline!;
          return (
            <li key={r.listing.id} className={cn("bg-card flex items-center gap-2 rounded-xl border p-2", p.pinned && "border-amber-400")}>
              <span className="text-muted-foreground w-6 text-center text-sm font-semibold tabular-nums">{i + 1}</span>
              <ScoreBadge score={r.score} />
              <div className="min-w-0 flex-1">
                <Link href={`/listing/${r.listing.id}`} className="line-clamp-1 text-sm font-medium hover:underline">
                  {r.listing.title}
                </Link>
                <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-foreground font-medium">{rentText(r.listing)}</span>
                  <PerPersonBadge perPerson={r.perPerson} cap={search.maxPerPerson} className="px-1 py-0 text-[11px]" />
                  <span>{bedsText(r.listing)}</span>
                  <span className="capitalize">· {p.stage.replace("_", " ")}</span>
                </div>
              </div>
              <div className="flex items-center">
                <Button size="icon-xs" variant="ghost" aria-label="Move up" onClick={() => move(r, -1)} disabled={p.pinned}>
                  <ArrowUp />
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label="Move down" onClick={() => move(r, 1)} disabled={p.pinned}>
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-xs"
                  variant={p.manual_rank != null ? "secondary" : "ghost"}
                  aria-label={p.manual_rank != null ? "Unlock position" : "Lock position"}
                  onClick={() => setManualRank(r.listing.id, p.manual_rank != null ? null : Math.max(1, i + 1 - pinnedCount))}
                  disabled={p.pinned}
                >
                  {p.manual_rank != null ? <Lock /> : <LockOpen />}
                </Button>
                <Button size="icon-xs" variant={p.pinned ? "secondary" : "ghost"} aria-label={p.pinned ? "Unpin" : "Pin"} onClick={() => setPinned(r.listing.id, !p.pinned)}>
                  {p.pinned ? <PinOff /> : <Pin />}
                </Button>
                <input
                  type="checkbox"
                  aria-label="Compare"
                  className="accent-primary ml-1 size-4"
                  checked={compare.includes(r.listing.id)}
                  onChange={() => setCompare((c) => (c.includes(r.listing.id) ? c.filter((x) => x !== r.listing.id) : c.length >= 4 ? c : [...c, r.listing.id]))}
                />
              </div>
            </li>
          );
        })}
      </ol>
      {shortlisted.length === 0 && (
        <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">Shortlist listings with ⭐ in the Inbox.</div>
      )}
    </div>
  );
}
