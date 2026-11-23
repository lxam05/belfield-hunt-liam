import { describe, expect, it } from "vitest";
import {
  effectiveBeds,
  fitsBudget,
  groupSizeTable,
  perPersonRent,
  totalCapForBeds,
} from "@/lib/budget";

const CAP = 1350;
const l = (monthly_rent: number | null, beds: number | null, beds_min = beds, beds_max = beds) => ({
  monthly_rent,
  beds,
  beds_min,
  beds_max,
});

describe("per-person budget", () => {
  it("total caps per bedroom count match the Daft filters", () => {
    expect([2, 3, 4, 5].map((b) => totalCapForBeds(b, CAP))).toEqual([2700, 4050, 5400, 6750]);
  });

  it.each([2, 3, 4, 5])("exact boundary for %i beds", (beds) => {
    expect(fitsBudget(l(beds * CAP, beds), CAP)).toBe(true);
    expect(fitsBudget(l(beds * CAP - 1, beds), CAP)).toBe(true);
    expect(fitsBudget(l(beds * CAP + beds, beds), CAP)).toBe(false);
  });

  it("a 6750 listing fits 5 beds but not 4 (fast-lane false positive filtered in-app)", () => {
    expect(fitsBudget(l(6750, 5), CAP)).toBe(true);
    expect(fitsBudget(l(6750, 4), CAP)).toBe(false);
  });

  it("unknown price or beds never fits", () => {
    expect(fitsBudget(l(null, 3), CAP)).toBe(false);
    expect(fitsBudget(l(3000, null, null, null), CAP)).toBe(false);
    expect(perPersonRent(3000, 0)).toBeNull();
  });

  it("developments use the smallest unit (what From X refers to)", () => {
    const dev = l(2700, null, 2, 3);
    expect(effectiveBeds(dev)).toBe(2);
    expect(perPersonRent(2700, effectiveBeds(dev))).toBe(1350);
    expect(fitsBudget(dev, CAP)).toBe(true);
  });

  it("group-size table: one person per bedroom, highlight fitting cells", () => {
    const t = groupSizeTable(l(4000, 3), CAP);
    expect(t.map((c) => c.groupSize)).toEqual([2, 3, 4, 5]);
    expect(t[0]).toEqual({ groupSize: 2, perPerson: 2000, roomsOk: true, fits: false });
    expect(t[1]).toEqual({ groupSize: 3, perPerson: 1333, roomsOk: true, fits: true });
    expect(t[2]).toEqual({ groupSize: 4, perPerson: null, roomsOk: false, fits: false });
    expect(t[3].fits).toBe(false);
  });

  it.each([
    [2, 2700, [true, false, false, false]],
    [3, 4050, [false, true, false, false]],
    [4, 5400, [false, false, true, false]],
    [5, 6750, [false, false, false, true]],
    [5, 4000, [false, true, true, true]],
    [4, 2600, [true, true, true, false]],
  ])("group-size table for %i beds at %i", (beds, rent, expected) => {
    expect(groupSizeTable(l(rent, beds), CAP).map((c) => c.fits)).toEqual(expected);
  });
});
