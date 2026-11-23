import { describe, expect, it } from "vitest";
import { assessRental, BELFIELD } from "@/lib/rental-search";

const listing = {
  ...BELFIELD,
  beds: 3,
  monthly_rent: 3899,
  price_is_from: false,
  price_on_application: false,
  geocode_precision: "rooftop",
};
describe("rental matches", () => {
  it("compares the unrounded monthly share", () => {
    expect(assessRental(listing, BELFIELD).matches).toBe(true);
    expect(assessRental({ ...listing, monthly_rent: 3900 }, BELFIELD).matches).toBe(false);
  });
  it("requires a known price and a located home within the radius", () => {
    for (const change of [
      { price_is_from: true },
      { beds: null },
      { price_on_application: true },
      { geocode_precision: "fallback" },
      { lng: null },
      { lat: 53.38 },
    ]) {
      expect(assessRental({ ...listing, ...change }, BELFIELD).matches).toBe(false);
    }
  });
});
