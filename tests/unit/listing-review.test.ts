import { expect, it } from "vitest";
import type { Row } from "@/lib/store/hooks";
import { isNewToday, isUnreviewed } from "@/lib/listing-review";

const now = Date.parse("2026-11-23T12:00:00Z");
const home = {
  listing: { first_seen_at: "2026-11-22T12:00:00Z", status: "active" },
  votes: [],
  notes: [],
  contacts: [],
} as unknown as Row;

it("keeps discovery time independent of group decisions and repeat scrapes", () => {
  const liked = { ...home, votes: [{ value: 1 }] } as Row;
  expect(isNewToday(liked, now)).toBe(true);
  expect(isUnreviewed(liked)).toBe(false);
  expect(isNewToday(home, now + 1)).toBe(false);
  expect(isUnreviewed(home)).toBe(true);
});

it("keeps a cleared vote in the queue unless another group action remains", () => {
  const untouched = {
    ...home,
    votes: [{ value: 0, stars: null }],
    pipeline: { stage: "new" },
  } as Row;
  expect(isUnreviewed(untouched)).toBe(true);
  for (const patch of [
    { votes: [{ value: -1 }] },
    { votes: [{ value: 0, stars: 3 }] },
    { pipeline: { stage: "applied" } },
    { pipeline: { stage: "new", hidden: true } },
    { notes: [{}] },
    { contacts: [{}] },
  ])
    expect(isUnreviewed({ ...untouched, ...patch } as Row)).toBe(false);
});
