"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  closestCenter,
  KeyboardSensor,
  PointerSensor,

  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMembers, useRows, useSearchSettings, type Row } from "@/lib/store/hooks";
import { setStage } from "@/lib/store/actions";
import { STAGES, type Stage } from "@/lib/store/types";
import { buildIcs } from "@/lib/ics";
import { MemberDot, PerPersonBadge, rentText } from "./bits";

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function CardBody({ row, cap }: { row: Row; cap: number }) {
  const members = useMembers();
  const l = row.listing;
  const p = row.pipeline;
  const owner = members.find((m) => m.id === p?.claimed_by);
  const overdue = p?.next_action_at && new Date(p.next_action_at) < new Date();
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-1">
        <Link href={`/listing/${l.id}`} className="line-clamp-2 text-xs font-medium hover:underline" onPointerDown={(e) => e.stopPropagation()}>
          {l.title}
        </Link>
        {owner && <MemberDot member={owner} size={20} />}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="font-semibold">{rentText(l)}</span>
        <PerPersonBadge perPerson={row.perPerson} cap={cap} className="px-1 py-0 text-[11px]" />
        <span className="text-muted-foreground">· {row.score.total}</span>
      </div>
      {p?.viewing_at && <div className="text-xs text-violet-700 dark:text-violet-300">👀 {fmtDate(p.viewing_at)}</div>}
      {p?.next_action_at && (
        <div className={cn("text-xs", overdue ? "text-red-600" : "text-muted-foreground")}>
          ⏰ {fmtDate(p.next_action_at)}
          {p.next_action ? ` · ${p.next_action}` : ""}
        </div>
      )}
    </div>
  );
}

function DraggableCard({ row, cap }: { row: Row; cap: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.listing.id });
  return (
    <div
      ref={setNodeRef}

      className={cn("paper-note bg-card rounded-lg border p-2 shadow-xs active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <button {...attributes} {...listeners} aria-label={`Drag ${row.listing.title}`} className="mb-2 w-full touch-none cursor-grab rounded border border-dashed py-1 text-xs active:cursor-grabbing">⠿ Drag to move</button>
      <CardBody row={row} cap={cap} />
      <select aria-label={`Move ${row.listing.title}`} value={row.pipeline?.stage ?? "new"} className="mt-2 rounded border bg-background p-1 text-xs" onChange={e=>void setStage(row.listing.id,e.target.value as Stage)}>{STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select>
    </div>
  );
}

function Column({ stage, label, rows, cap }: { stage: Stage; label: string; rows: Row[]; cap: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={cn("bg-muted/40 flex min-w-0 flex-col rounded-xl border p-2 transition-colors", isOver && "bg-primary/10 border-primary")}
    >
      <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
        {label} <span className="text-muted-foreground text-xs font-normal">{rows.length}</span>
      </h2>
      <div className="flex min-h-24 flex-col gap-2">
        {rows.map((r) => (
          <DraggableCard key={r.listing.id} row={r} cap={cap} />
        ))}
      </div>
    </section>
  );
}

export function PipelineBoard() {
  const rows = useRows();
  const search = useSearchSettings();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),

    useSensor(KeyboardSensor),
  );

  const byStage = useMemo(() => {
    const m = new Map<Stage, Row[]>();
    for (const s of STAGES) m.set(s.id, []);
    for (const r of rows) {
      const stage = r.pipeline?.stage ?? "new";
      // Include matching rentals and any home the group is already pursuing.
      if (stage === "new" && !r.pipeline?.claimed_by && !r.fits) continue;
      if (r.pipeline?.hidden || r.listing.status === "gone") continue;
      m.get(stage)!.push(r);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.score.total - a.score.total);
    return m;
  }, [rows]);

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = Number(e.active.id);
    const to = e.over?.id as Stage | undefined;
    if (!to) return;
    const current = rows.find((r) => r.listing.id === id)?.pipeline?.stage;
    if (current !== to) void setStage(id, to);
  }

  function exportIcs() {
    const events = rows
      .filter((r) => r.pipeline?.viewing_at)
      .map((r) => ({
        uid: `viewing-${r.listing.id}`,
        start: new Date(r.pipeline!.viewing_at!),
        title: `Viewing: ${r.listing.title}`,
        location: r.listing.title,
        description: `${rentText(r.listing)}/month · ${r.listing.seller_name ?? ""} ${r.listing.seller_phone ?? ""}\n${r.listing.url}`,
        url: r.listing.url,
      }));
    const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "belfield-hunt-viewings.ics";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const visibleStages = STAGES.filter(s => showRejected || ["new","shortlisted","viewing_booked","applied"].includes(s.id) || byStage.get(s.id)!.length > 0);
  const active = rows.find((r) => r.listing.id === activeId);
  const viewingCount = rows.filter((r) => r.pipeline?.viewing_at).length;

  return (
    <div className="space-y-3 px-3 pt-3 pb-28">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Pipeline</h1>
        <label className="text-muted-foreground ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="accent-primary" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} /> All stages
        </label>
        <Button size="sm" variant="outline" onClick={exportIcs} disabled={viewingCount === 0}>
          <CalendarPlus /> Export viewings ({viewingCount})
        </Button>
      </div>
      <DndContext collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)} sensors={sensors} onDragStart={(e) => setActiveId(Number(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid grid-cols-2 items-start gap-3 pb-4 lg:grid-cols-4">
          {visibleStages.map((s) => (
            <Column key={s.id} stage={s.id} label={s.label} rows={byStage.get(s.id) ?? []} cap={search.maxPerPerson} />
          ))}
        </div>
        <DragOverlay>
          {active ? (
            <div className="bg-card w-60 rounded-lg border p-2 shadow-lg">
              <CardBody row={active} cap={search.maxPerPerson} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
