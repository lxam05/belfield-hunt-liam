import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/daft-sample.json";
import {
  deriveArea,
  extractEircode,
  normalizeDaftUrl,
  normalizeItem,
  normalizeItems,
  parseBaths,
  parseBeds,
  parsePrice,
} from "@/lib/daft/parse";

describe("quirk 1: malformed rental URL", () => {
  it("rewrites /for-sale/for-rent/ to /for-rent/", () => {
    expect(
      normalizeDaftUrl(
        "https://www.daft.ie/for-sale/for-rent/39-abbeyfield-milltown-dublin-6/6727385",
      ),
    ).toBe("https://www.daft.ie/for-rent/39-abbeyfield-milltown-dublin-6/6727385");
  });
  it("leaves correct URLs alone and fixes relative/http ones", () => {
    expect(normalizeDaftUrl("https://www.daft.ie/for-rent/a/1")).toBe(
      "https://www.daft.ie/for-rent/a/1",
    );
    expect(normalizeDaftUrl("/for-sale/for-rent/a/1")).toBe("https://www.daft.ie/for-rent/a/1");
    expect(normalizeDaftUrl("http://daft.ie/for-rent/a/1")).toBe(
      "https://www.daft.ie/for-rent/a/1",
    );
  });
  it("keeps the raw value on the normalized listing", () => {
    const n = normalizeItem(fixtures[0]);
    expect(n.url).toBe("https://www.daft.ie/for-rent/39-abbeyfield-milltown-dublin-6/6727385");
    expect(n.raw_url).toBe(
      "https://www.daft.ie/for-sale/for-rent/39-abbeyfield-milltown-dublin-6/6727385",
    );
  });
  it("falls back to an id-based URL when missing", () => {
    expect(normalizeDaftUrl(null, 42)).toBe("https://www.daft.ie/for-rent/listing/42");
  });
});

describe("quirk 2: Eircode detection for geocoding", () => {
  it("finds a trailing Eircode", () => {
    expect(extractEircode("Apartment 12, The Grange, Stillorgan, Co. Dublin, A94 FD70")).toBe(
      "A94 FD70",
    );
    expect(extractEircode("1 Main St, Dublin 4, D04X285")).toBe("D04 X285");
    expect(extractEircode("Flat 3, Rathmines, Dublin 6W, D6W XY12")).toBe("D6W XY12");
  });
  it("ignores titles without one or with one mid-string", () => {
    expect(extractEircode("39 Abbeyfield, Milltown, Dublin 6")).toBeNull();
    expect(extractEircode("A94 FD70 Lane, Blackrock")).toBeNull();
  });
  it("rejects invalid routing keys", () => {
    expect(extractEircode("Somewhere, B94 FD70")).toBeNull();
    expect(extractEircode("Somewhere, Z12 AB34")).toBeNull();
  });
  it("is set on normalized listings", () => {
    expect(normalizeItem(fixtures[1]).eircode).toBe("A94 FD70");
    expect(normalizeItem(fixtures[0]).eircode).toBeNull();
  });
});

describe("quirk 3: price parsing", () => {
  it("monthly as is", () => {
    expect(parsePrice("€3,100 per month")).toEqual({
      monthlyRent: 3100,
      priceIsFrom: false,
      priceOnApplication: false,
    });
  });
  it("weekly x 52 / 12", () => {
    expect(parsePrice("€650 per week").monthlyRent).toBe(Math.round((650 * 52) / 12));
  });
  it("From €X sets priceIsFrom", () => {
    expect(parsePrice("From €2,700 per month")).toEqual({
      monthlyRent: 2700,
      priceIsFrom: true,
      priceOnApplication: false,
    });
  });
  it("non-numeric gives null + priceOnApplication", () => {
    expect(parsePrice("Price on Application")).toEqual({
      monthlyRent: null,
      priceIsFrom: false,
      priceOnApplication: true,
    });
    expect(parsePrice("")).toMatchObject({ monthlyRent: null, priceOnApplication: true });
    expect(parsePrice(null)).toMatchObject({ monthlyRent: null, priceOnApplication: true });
  });
});

describe("quirk 4: bedrooms", () => {
  it("single value", () => {
    expect(parseBeds("3 Bed")).toEqual({ beds: 3, bedsMin: 3, bedsMax: 3, isDevelopment: false });
  });
  it("multi-unit development", () => {
    expect(parseBeds("1, 2 & 3 bed")).toEqual({
      beds: null,
      bedsMin: 1,
      bedsMax: 3,
      isDevelopment: true,
    });
    expect(parseBeds("2 & 3 bed")).toMatchObject({ bedsMin: 2, bedsMax: 3, isDevelopment: true });
  });
  it("studio and missing", () => {
    expect(parseBeds("Studio")).toMatchObject({ beds: 1 });
    expect(parseBeds(undefined)).toEqual({
      beds: null,
      bedsMin: null,
      bedsMax: null,
      isDevelopment: false,
    });
  });
  it("baths", () => {
    expect(parseBaths("2 Bath")).toBe(2);
    expect(parseBaths("")).toBeNull();
  });
});

describe("quirk 5: dedupe on id", () => {
  it("keeps one row per id, last occurrence wins, and reports invalid items", () => {
    const { listings, errors } = normalizeItems(fixtures);
    const ids = listings.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === 6727385)).toHaveLength(1);
    expect(listings.find((l) => l.id === 6727385)!.monthly_rent).toBe(3050);
    expect(errors).toHaveLength(1);
    expect(listings).toHaveLength(6);
  });
});

describe("quirk 6: area derived from the title", () => {
  it("uses the Dublin postcode district", () => {
    expect(deriveArea("39 Abbeyfield, Milltown, Dublin 6")).toEqual({
      area: "Dublin 6",
      suburb: "Milltown",
    });
    expect(deriveArea("Flat 3, 22 Belgrave Square, Rathmines, Dublin 6W, D6W XY12").area).toBe(
      "Dublin 6W",
    );
    expect(deriveArea("5 Kilmacud Road Upper, Sandyford, Dublin 18")).toEqual({
      area: "Dublin 18",
      suburb: "Sandyford",
    });
  });
  it("uses a known suburb for Co. Dublin addresses", () => {
    expect(deriveArea("14 Seafield Avenue, Blackrock, Co. Dublin").area).toBe("Blackrock");
    expect(
      deriveArea("Apartment 12, The Grange, Stillorgan Road, Stillorgan, Co. Dublin, A94 FD70")
        .area,
    ).toBe("Stillorgan");
  });
  it("never uses search.location", () => {
    expect(normalizeItem(fixtures[3]).area).toBe("Blackrock");
  });
  it("falls back to Co. Dublin", () => {
    expect(deriveArea("Somewhere").area).toBe("Co. Dublin");
  });
});

describe("normalizeItem", () => {
  it("maps all fields", () => {
    expect(normalizeItem(fixtures[2])).toMatchObject({
      id: 6698410,
      daft_shortcode: "26698410",
      area: "Dublin 14",
      monthly_rent: 2700,
      price_is_from: true,
      is_development: true,
      beds_min: 1,
      beds_max: 3,
      baths: null,
      seller_phone: "+35316382700",
      image_cover: "https://media.daft.ie/x/6698410_1.jpg",
      image_count: 22,
      published_at: "2026-11-18T09:00:00.000Z",
    });
  });
  it("handles missing optional fields", () => {
    expect(normalizeItem({ id: "123", title: "1 Road, Dublin 4" })).toMatchObject({
      id: 123,
      monthly_rent: null,
      price_on_application: true,
      images: [],
      has_video: false,
    });
  });
  it("rejects items with no id or title", () => {
    expect(() => normalizeItem({ title: "x" })).toThrow();
    expect(() => normalizeItem({ id: 1 })).toThrow();
  });
});
