import { describe, expect, it } from "vitest";
import { geocodeQueryVariants } from "@/lib/enrich/geocode";

describe("geocode query variants", () => {
  it("strips units, notes and duplicates, and adds a street-level query", () => {
    expect(geocodeQueryVariants("Apartment 12, The Grange, Stillorgan Road, Stillorgan, Co. Dublin, A94 FD70")).toEqual([
      "Apartment 12, The Grange, Stillorgan Road, Stillorgan, Co. Dublin, A94 FD70, Ireland",
      "The Grange, Stillorgan Road, Stillorgan, Dublin, Ireland",
      "Stillorgan Road, Stillorgan, Dublin, Ireland",
    ]);
    expect(geocodeQueryVariants("21 Dargle Road, Blackrock (6-7 Month Let), Blackrock, Co. Dublin")[2]).toBe(
      "Dargle Road, Blackrock, Dublin, Ireland",
    );
    expect(geocodeQueryVariants("Pine Valley Grove, Rathfarnham, Rathfarnham, Dublin 16")[1]).toBe(
      "Pine Valley Grove, Rathfarnham, Dublin 16, Ireland",
    );
  });
  it("prefers the last street-like part", () => {
    expect(geocodeQueryVariants("85 The Sycamores, Rockford Manor, Stradbrook Road, Blackrock, Monkstown, Co. Dublin").at(-1)).toBe(
      "Stradbrook Road, Monkstown, Dublin, Ireland",
    );
  });
});
