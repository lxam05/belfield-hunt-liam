import { describe, expect, it } from "vitest";
import {
  commuteValue,
  commutersFor,
  freshnessValue,
  memberMinutes,
  scoreListing,
  type ScoreContext,
} from "@/lib/scoring";

const now = new Date("2026-11-20T12:00:00Z");
const ctx: ScoreContext = {
  maxPerPerson: 1350,
  groupSizeMin: 2,
  groupSizeMax: 5,
  bedsMin: 2,
  bedsMax: 5,
  destinations: [
    { id: "ucd", short_name: "UCD", is_intern_site: false },
    { id: "sf", short_name: "Sandyford", is_intern_site: true },
  ],
  members: [
    { id: "a", interns_at_sandyford: false, commute_mode: "best" },
    { id: "b", interns_at_sandyford: false, commute_mode: "transit" },
    { id: "c", interns_at_sandyford: true, commute_mode: "best" },
  ],
  now,
};
const listing = {
  monthly_rent: 3000,
  beds: 3,
  beds_min: 3,
  beds_max: 3,
  published_at: "2026-11-20T11:00:00Z",
};
const commutes = [
  { destination_id: "ucd", mode: "transit" as const, minutes: 30 },
  { destination_id: "ucd", mode: "bicycle" as const, minutes: 12 },
  { destination_id: "sf", mode: "transit" as const, minutes: 25 },
  { destination_id: "sf", mode: "bicycle" as const, minutes: 20 },
];

describe("scoring", () => {
  it("is within 0-100 and parts sum to the total", () => {
    const r = scoreListing(listing, commutes, [], ctx);
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    const sum = r.parts.reduce((a, p) => a + p.points, 0);
    expect(Math.abs(sum - r.total)).toBeLessThan(1);
  });

  it("uses the worse-off member's time per destination", () => {
    expect(memberMinutes(commutes, "ucd", "best")).toBe(12);
    expect(memberMinutes(commutes, "ucd", "transit")).toBe(30);
    const c = scoreListing(listing, commutes, [], ctx).parts.find((p) => p.key === "commute")!;
    expect(c.detail).toContain("UCD 30m (×2)");
    expect(c.detail).toContain("Sandyford 20m (×1)");
    expect(c.value).toBeCloseTo((commuteValue(30) * 2 + commuteValue(20)) / 3, 5);
  });

  it("assigns interns to Sandyford and others to UCD unless explicit", () => {
    expect(commutersFor(ctx.destinations[1], ctx.members).map((m) => m.id)).toEqual(["c"]);
    expect(
      commutersFor({ ...ctx.destinations[1], who_commutes: ["a", "c"] }, ctx.members).map(
        (m) => m.id,
      ),
    ).toEqual(["a", "c"]);
  });

  it("cheaper, fresher, liked listings score higher", () => {
    const base = scoreListing(listing, commutes, [], ctx).total;
    expect(
      scoreListing({ ...listing, monthly_rent: 2400 }, commutes, [], ctx).total,
    ).toBeGreaterThan(base);
    expect(
      scoreListing({ ...listing, published_at: "2026-11-15T12:00:00Z" }, commutes, [], ctx).total,
    ).toBeLessThan(base);
    expect(
      scoreListing(listing, commutes, [{ member_id: "a", value: 1, stars: 5 }], ctx).total,
    ).toBeGreaterThan(base);
  });

  it("over budget gives zero affordability; weights are respected", () => {
    const r = scoreListing({ ...listing, monthly_rent: 4500 }, commutes, [], ctx);
    expect(r.parts.find((p) => p.key === "affordability")!.value).toBe(0);
    const onlyAfford = scoreListing(listing, commutes, [], {
      ...ctx,
      weights: { affordability: 1, commute: 0, freshness: 0, beds: 0, votes: 0 },
    });
    expect(onlyAfford.total).toBe(Math.round(((1350 - 1000) / 1350) * 100));
  });

  it("works with no members yet (system scoring at ingestion)", () => {
    const r = scoreListing(listing, commutes, [], { ...ctx, members: [] });
    expect(r.parts.find((p) => p.key === "commute")!.detail).toContain("UCD 12m");
  });

  it("helper curves", () => {
    expect(commuteValue(10)).toBe(1);
    expect(commuteValue(60)).toBe(0);
    expect(freshnessValue(0)).toBe(1);
    expect(freshnessValue(36)).toBeCloseTo(Math.exp(-1));
  });
});

it("ranks a located home south of work below the same home north of work", () => {
  const score = (lat: number, precision = "street") =>
    scoreListing({ ...listing, lat, geocode_precision: precision }, commutes, [], ctx).total;
  expect(Math.abs(score(53.26) - score(53.30) * 0.6)).toBeLessThan(1);
  expect(score(53.26, "area")).toBe(score(53.30));
});
