"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Hand, MapPin, MessageSquare, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useDestinations, useMe, useMembers, useRow, useSearchSettings } from "@/lib/store/hooks";
import { addNote, claim, deleteNote, recomputeListing, setNextAction, setStage, setStars, setViewing, unclaim, vote } from "@/lib/store/actions";
import { STAGES, type Commute, type Destination, type Stage } from "@/lib/store/types";
import { groupSizeTable, formatEuro } from "@/lib/budget";
import { formatAgo } from "@/lib/time";
import { AgeBadge, MemberDot, PerPersonBadge, ScoreBadge, Stars, Voters, bedsText, rentText, useNow } from "./bits";
import { ContactDialog } from "./contact-dialog";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function GroupSizeTable({
  listing,
  cap,
  sizes,
}: {
  listing: { monthly_rent: number | null; beds: number | null; beds_min: number | null; beds_max: number | null };
  cap: number;
  sizes: { min: number; max: number };
}) {
  const cells = groupSizeTable(listing, cap, sizes);
  return (
    <div className="grid grid-flow-col gap-1 text-center text-xs" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((c) => (
        <div
          key={c.groupSize}
          className={cn(
            "rounded-md border px-1 py-1.5",
            c.fits ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" : "text-muted-foreground",
          )}
          title={c.roomsOk ? `${c.groupSize} people` : "Not enough bedrooms (one person per room)"}
        >
          <div className="font-medium">{c.groupSize} ppl</div>
          <div className="tabular-nums">{c.perPerson != null ? formatEuro(c.perPerson) : c.roomsOk ? "—" : "n/a"}</div>
        </div>
      ))}
    </div>
  );
}

export function CommuteBreakdown({ destinations, commutes }: { destinations: Destination[]; commutes: Commute[] }) {
  const modeLabel: Record<string, string> = { transit: "🚌 Transit 08:30", transit_return: "🚌 Return 18:00", bicycle: "🚲 Bike", walk: "🚶 Walk" };
  return (
    <div className="space-y-3">
      {destinations.map((d) => {
        const mine = commutes.filter((c) => c.destination_id === d.id);
        return (
          <div key={d.id}>
            <div className="mb-1 text-sm font-medium">
              {d.emoji} {d.name}
            </div>
            {mine.length === 0 ? (
              <p className="text-muted-foreground text-xs">Not computed yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {["transit", "transit_return", "bicycle", "walk"].map((mode) => {
                  const c = mine.find((x) => x.mode === mode);
                  if (!c) return null;
                  return (
                    <li key={mode} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="w-32 shrink-0">{modeLabel[mode]}</span>
                      <span className="font-semibold tabular-nums">
                        {c.source === "estimate" ? "~" : ""}
                        {c.minutes ?? "?"} min
                      </span>
                      {c.transfers != null && <span className="text-muted-foreground text-xs">{c.transfers} transfer{c.transfers === 1 ? "" : "s"}</span>}
                      {c.walk_minutes != null && <span className="text-muted-foreground text-xs">{c.walk_minutes} min walking</span>}
                      {c.lines.length > 0 && <span className="text-xs">{c.lines.join(" → ")}</span>}
                      {c.source === "estimate" && <span className="text-[10px] text-amber-600">estimate</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ListingDetail({ id: idProp }: { id?: number }) {
  const params = useParams<{ id: string }>();
  const id = idProp ?? Number(params.id);
  const row = useRow(id);
  const me = useMe();
  const members = useMembers();
  const destinations = useDestinations();
  const search = useSearchSettings();
  const now = useNow();
  const [contactOpen, setContactOpen] = useState(false);
  const [note, setNote] = useState("");

  if (!row) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="font-medium">Listing not found</p>
        <p className="text-muted-foreground text-sm">It may be older than 60 days or marked gone.</p>
        <Link href="/" className="text-primary mt-3 inline-block text-sm underline">
          Back to inbox
        </Link>
      </div>
    );
  }
  const l = row.listing;
  const p = row.pipeline;
  const claimer = members.find((m) => m.id === p?.claimed_by);
  const mine = p?.claimed_by === me?.id;
  const myVote = row.votes.find((v) => v.member_id === me?.id);
  const images = l.images.length ? l.images : l.image_cover ? [l.image_cover] : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3 pt-3 pb-28 sm:px-4">
      <Link href="/" className="text-muted-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> Map
      </Link>

      {images.length > 0 && (
        <div className="-mx-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt={`Photo ${i + 1}`} loading={i < 2 ? "eager" : "lazy"} referrerPolicy="origin" className="h-56 w-auto max-w-[85vw] shrink-0 snap-start rounded-lg object-cover sm:h-72" />
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{l.title}</h1>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{rentText(l)}</span>
            <span className="text-muted-foreground text-sm">/month</span>
            <PerPersonBadge perPerson={row.perPerson} cap={search.maxPerPerson} />
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <span>{bedsText(l)}</span>
            <span>· {l.property_type}</span>
            <span>· {l.area}</span>
            <AgeBadge iso={l.published_at ?? l.first_seen_at} now={now} />
          </div>
          {l.price_text && l.price_text !== rentText(l) && <div className="text-muted-foreground text-xs">Daft: “{l.price_text}”</div>}
        </div>
        <ScoreBadge score={row.score} className="h-10 min-w-12 text-base" />
      </div>

      <div className="flex flex-wrap gap-2">
        {mine ? (
          <Button variant="secondary" onClick={() => unclaim(l.id)}>
            <Hand /> Release claim
          </Button>
        ) : (
          <Button disabled={!!claimer} onClick={() => claim(l.id)}>
            <Hand /> {claimer ? `Claimed by ${claimer.display_name}` : "Claim"}
          </Button>
        )}
        <Button variant="outline" onClick={() => setContactOpen(true)}>
          <MessageSquare /> Contact
        </Button>
        <Button variant="outline" render={<a href={l.url} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
          <ExternalLink /> Open on Daft
        </Button>
        <Button variant="ghost" render={<Link href={`/map?focus=${l.id}`} />} nativeButton={false}>
          <MapPin /> Map
        </Button>
      </div>

      <section className="bg-card space-y-2 rounded-xl border p-3">
        <h2 className="text-sm font-semibold">Per person by group size (one per bedroom)</h2>
        <GroupSizeTable listing={l} cap={search.maxPerPerson} sizes={{ min: search.groupSizeMin, max: search.groupSizeMax }} />
        {l.is_development && <p className="text-muted-foreground text-xs">Development listing: the price is for the smallest unit.</p>}
      </section>

      <section className="bg-card space-y-2 rounded-xl border p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Commute</h2>
          <Button size="xs" variant="ghost" onClick={() => recomputeListing(l.id)} title="Recompute (uses Google calls)">
            <RotateCw /> Recompute
          </Button>
        </div>
        <CommuteBreakdown destinations={destinations} commutes={row.commutes} />
        {l.geocode_precision && ["area", "fallback"].includes(l.geocode_precision) && (
          <p className="text-xs text-amber-600">Location is approximate ({l.geocode_precision}): times may be off.</p>
        )}
      </section>

      <section className="bg-card space-y-3 rounded-xl border p-3">
        <h2 className="text-sm font-semibold">Pipeline</h2>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">Stage</span>
            <select className="bg-background block w-full rounded-md border px-2 py-1.5" value={p?.stage ?? "new"} onChange={(e) => setStage(l.id, e.target.value as Stage)}>
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">Viewing</span>
            <input
              type="datetime-local"
              className="bg-background block w-full rounded-md border px-2 py-1.5"
              defaultValue={toLocalInput(p?.viewing_at ?? null)}
              onBlur={(e) => setViewing(l.id, e.target.value ? new Date(e.target.value).toISOString() : null)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">Next action date</span>
            <input
              type="datetime-local"
              className="bg-background block w-full rounded-md border px-2 py-1.5"
              defaultValue={toLocalInput(p?.next_action_at ?? null)}
              onBlur={(e) => setNextAction(l.id, e.target.value ? new Date(e.target.value).toISOString() : null, p?.next_action ?? null)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">Next action</span>
            <input
              className="bg-background block w-full rounded-md border px-2 py-1.5"
              placeholder="e.g. follow up by phone"
              defaultValue={p?.next_action ?? ""}
              onBlur={(e) => setNextAction(l.id, p?.next_action_at ?? null, e.target.value || null)}
            />
          </label>
        </div>
      </section>

      <section className="bg-card space-y-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Votes</h2>
          <Voters votes={row.votes} members={members} />
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant={myVote?.value === 1 ? "secondary" : "outline"} onClick={() => vote(l.id, myVote?.value === 1 ? 0 : 1)}>
            👍
          </Button>
          <Button size="sm" variant={myVote?.value === -1 ? "secondary" : "outline"} onClick={() => vote(l.id, myVote?.value === -1 ? 0 : -1)}>
            👎
          </Button>
          <Stars value={myVote?.stars ?? null} onChange={(v) => setStars(l.id, v)} />
        </div>
      </section>

      <section className="bg-card space-y-3 rounded-xl border p-3">
        <h2 className="text-sm font-semibold">Notes</h2>
        <ul className="space-y-2">
          {row.notes.map((n) => {
            const m = members.find((x) => x.id === n.member_id);
            return (
              <li key={n.id} className="flex gap-2 text-sm">
                <MemberDot member={m} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="text-muted-foreground text-xs">
                    {m?.display_name} · {formatAgo(n.created_at, now)}
                  </div>
                  <p className="break-words whitespace-pre-wrap">{n.body}</p>
                </div>
                {n.member_id === me?.id && (
                  <Button size="icon-xs" variant="ghost" aria-label="Delete note" onClick={() => deleteNote(l.id, n.id)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addNote(l.id, note);
            setNote("");
          }}
        >
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note for the group…" className="min-h-0" />
          <Button type="submit" disabled={!note.trim()}>
            Add
          </Button>
        </form>
      </section>

      <section className="bg-card space-y-2 rounded-xl border p-3 text-sm">
        <h2 className="font-semibold">Agent & history</h2>
        <p>
          {l.seller_name ?? "Unknown agent"}
          {l.seller_phone && (
            <>
              {" · "}
              <a className="text-primary underline" href={`tel:${l.seller_phone}`}>
                {l.seller_phone}
              </a>
            </>
          )}
        </p>
        <p className="text-muted-foreground text-xs">
          Listed {formatAgo(l.published_at, now)} · first seen {formatAgo(l.first_seen_at, now)} · last seen {formatAgo(l.last_seen_at, now)} · Daft #{l.id}
          {l.status !== "active" && ` · status: ${l.status.replace("_", " ")}`}
        </p>
        {row.contacts.length > 0 && (
          <ul className="space-y-1 text-xs">
            {row.contacts.map((c) => (
              <li key={c.id}>
                {members.find((m) => m.id === c.member_id)?.display_name} contacted via {c.channel} · {formatAgo(c.at, now)}
                {c.outcome ? ` · ${c.outcome}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      {contactOpen && <ContactDialog listing={l} open={contactOpen} onOpenChange={setContactOpen} />}
    </div>
  );
}
