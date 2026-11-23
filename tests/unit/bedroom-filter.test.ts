import { expect, it } from "vitest";
import { matchesBedrooms, readBedrooms } from "@/lib/bedroom-filter";

it("matches any selected bedroom count, including a development's range", () => {
  const selected = readBedrooms("4,2,2,6");
  expect(selected).toEqual([2, 4]);
  const exact = { beds: 3, beds_min: null, beds_max: null };
  expect(matchesBedrooms(exact, selected)).toBe(false);
  expect(matchesBedrooms({ ...exact, beds: 4 }, selected)).toBe(true);
  expect(matchesBedrooms({ beds: null, beds_min: 1, beds_max: 3 }, selected)).toBe(true);
  const unknown = { ...exact, beds: null };
  expect(matchesBedrooms(unknown, selected)).toBe(false);
  expect(matchesBedrooms(unknown, readBedrooms(null))).toBe(true);
});
