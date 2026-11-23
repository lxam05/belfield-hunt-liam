"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, EyeOff, Hand, MessageSquare, Star, ThumbsDown, ThumbsUp, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Row } from "@/lib/store/hooks";
import type { Destination, Member } from "@/lib/store/types";
import { claim, hide, shortlist, unclaim, vote, unhide } from "@/lib/store/actions";
import { AgeBadge, CommuteChips, MemberDot, PerPersonBadge, ScoreBadge, Voters, bedsText, rentText } from "./bits";
import { ContactDialog } from "./contact-dialog";

export function ListingCard({
  row,
  me,
  members,
  destinations,
  cap,
  now,
  selected,
  compareChecked,
  onToggleCompare,
}: {
  row: Row;
  me: Member | null;
  members: Member[];
  destinations: Destination[];
  cap: number;
  now: Date;
  selected?: boolean;
  compareChecked?: boolean;
  onToggleCompare?: (id: number) => void;
}) {
  const l = row.listing;
  const p = row.pipeline;
  const [contactOpen, setContactOpen] = useState(false);
  const claimer = members.find((m) => m.id === p?.claimed_by);
  const mine = p?.claimed_by === me?.id;
  const myVote = row.votes.find((v) => v.member_id === me?.id)?.value ?? 0;

  return (
    <article
      data-listing-id={l.id}
      data-selected={selected || undefined}
      className={cn(
        "bg-card text-card-foreground group relative overflow-hidden rounded-xl border shadow-xs transition",
        selected && "ring-primary ring-2",
        p?.hidden && "opacity-60",
        l.status !== "active" && "opacity-75",
      )}
    >
      <div className="flex gap-3 p-3">
        <Link href={`/listing/${l.id}`} className="bg-muted relative block size-24 shrink-0 overflow-hidden rounded-lg sm:size-32" prefetch={false}>
          {l.image_cover ? (
            // Daft's CDN images (403 without a Referer, so send our origin). No next/image: would cost Vercel quota.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.image_cover} alt="" loading="lazy" className="size-full object-cover" referrerPolicy="origin" />
          ) : (
            <span className="text-muted-foreground flex size-full items-center justify-center">
              <ImageOff className="size-6" />
            </span>
          )}
          {l.image_count > 0 && <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white">{l.image_count} 📷</span>}
        </Link>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-lg font-semibold tabular-nums">{rentText(l)}</span>
                <PerPersonBadge perPerson={row.perPerson} cap={cap} />
              </div>
              <Link href={`/listing/${l.id}`} prefetch={false} className="line-clamp-2 text-sm font-medium hover:underline">
                {l.title}
              </Link>
            </div>
            <ScoreBadge score={row.score} />
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{bedsText(l)}</span>
            <span>· {l.area}</span>
            {l.property_type && <span>· {l.property_type}</span>}
            <AgeBadge iso={l.published_at ?? l.first_seen_at} now={now} />
            {l.status === "possibly_gone" && <span className="text-amber-600">· possibly gone</span>}
            {l.is_development && <span className="text-violet-600 dark:text-violet-300">· development</span>}
          </div>
          <CommuteChips destinations={destinations} commutes={row.commutes} />
          <div className="flex items-center gap-2 text-xs">
            {claimer && (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5", mine ? "bg-primary/10" : "bg-amber-500/15")}>
                <MemberDot member={claimer} size={16} /> {mine ? "You're on it" : `${claimer.display_name} claimed`}
              </span>
            )}
            {p && p.stage !== "new" && <span className="bg-muted rounded-full px-1.5 py-0.5 capitalize">{p.stage.replace("_", " ")}</span>}
            <Voters votes={row.votes} members={members} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
        {mine ? (
          <Button size="sm" variant="secondary" onClick={() => unclaim(l.id)} aria-label="Release claim">
            <Hand /> Release
          </Button>
        ) : (
          <Button size="sm" variant={claimer ? "outline" : "default"} disabled={!!claimer} onClick={() => claim(l.id)} aria-label="Claim">
            <Hand /> {claimer ? "Claimed" : "Claim"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setContactOpen(true)}>
          <MessageSquare /> Contact
        </Button>
        <Button size="sm" variant="ghost" render={<a href={l.url} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
          <ExternalLink /> Daft
        </Button>
        <div className="ml-auto flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" className={myVote > 0 ? "bg-[#e11d74] text-white hover:bg-[#c0175f] hover:text-white" : ""} aria-label="I like this" title="I like this" aria-pressed={myVote > 0} onClick={() => vote(l.id, myVote > 0 ? 0 : 1)}>
            <ThumbsUp />
          </Button>
          <Button size="icon-sm" variant={myVote < 0 ? "secondary" : "ghost"} aria-label="Thumbs down" aria-pressed={myVote < 0} onClick={() => vote(l.id, myVote < 0 ? 0 : -1)}>
            <ThumbsDown />
          </Button>
          <Button size="icon-sm" variant={p?.stage === "shortlisted" ? "secondary" : "ghost"} aria-label="Shortlist" onClick={() => shortlist(l.id)}>
            <Star />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={p?.hidden ? "Unhide" : "Hide"} onClick={() => (p?.hidden ? unhide(l.id) : hide(l.id))}>
            <EyeOff />
          </Button>
          {onToggleCompare && (
            <label className="text-muted-foreground ml-1 flex cursor-pointer items-center gap-1 text-xs" title="Add to compare">
              <input type="checkbox" checked={!!compareChecked} onChange={() => onToggleCompare(l.id)} className="accent-primary size-4" />
              <span className="hidden sm:inline">Compare</span>
            </label>
          )}
        </div>
      </div>
      {contactOpen && <ContactDialog listing={l} open={contactOpen} onOpenChange={setContactOpen} />}
    </article>
  );
}
