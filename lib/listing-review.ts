import type { Row } from "@/lib/store/hooks";

export type ReviewFilter = "all" | "new" | "unreviewed";

export function isUnreviewed({ listing, pipeline: p, votes, contacts, notes }: Row) {
  return (
    listing.status !== "gone" &&
    (!p ||
      (p.stage === "new" &&
        !p.hidden &&
        !p.claimed_by &&
        !p.pinned &&
        p.manual_rank == null &&
        !p.next_action &&
        !p.next_action_at &&
        !p.viewing_at)) &&
    !votes.some((v) => v.value !== 0 || v.stars != null) &&
    contacts.length === 0 &&
    notes.length === 0
  );
}

export function firstSeenBetween(firstSeen: string, start: number, end: number) {
  const time = Date.parse(firstSeen);
  return time >= start && time <= end;
}
