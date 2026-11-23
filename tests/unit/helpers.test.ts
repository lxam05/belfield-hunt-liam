import { describe, expect, it } from "vitest";
import { parseRoutesResponse } from "@/lib/enrich/routes";
import { estimateCommute } from "@/lib/enrich/estimate";
import { apifyRunCost, cadenceTable, googleCost, runsPerDay } from "@/lib/costs";
import { dublinOffsetMinutes, monthKey, nextWeekdayAt } from "@/lib/time";
import { commuteChips, parseCallbackData, telegramCaption, escapeHtml } from "@/lib/notify/format";
import { safeEqual } from "@/lib/ingest/secure";
import { shouldNotify } from "@/lib/notify";

describe("Routes API response parser", () => {
  it("extracts minutes, walking, transfers and line names", () => {
    const r = parseRoutesResponse(
      {
        routes: [
          {
            duration: "1500s",
            distanceMeters: 6200,
            legs: [
              {
                steps: [
                  { travelMode: "WALK", staticDuration: "240s" },
                  { travelMode: "TRANSIT", staticDuration: "600s", transitDetails: { transitLine: { nameShort: "11", vehicle: { type: "BUS" } } } },
                  { travelMode: "WALK", staticDuration: "60s" },
                  { travelMode: "TRANSIT", staticDuration: "420s", transitDetails: { transitLine: { name: "Green Line", vehicle: { type: "LIGHT_RAIL" } } } },
                  { travelMode: "WALK", staticDuration: "180s" },
                ],
              },
            ],
          },
        ],
      },
      "TRANSIT",
    );
    expect(r).toEqual({ minutes: 25, distanceM: 6200, walkMinutes: 8, transfers: 1, lines: ["11", "Green Line"] });
  });
  it("handles bicycle and empty responses", () => {
    expect(parseRoutesResponse({ routes: [{ duration: "720s", distanceMeters: 3000 }] }, "BICYCLE")!.minutes).toBe(12);
    expect(parseRoutesResponse({}, "TRANSIT")).toBeNull();
  });
});

describe("fallback estimator", () => {
  it("gives plausible times and only walks under 3 km", () => {
    const milltown = { lat: 53.3105, lng: -6.2495 };
    const ucd = { lat: 53.3075, lng: -6.2236 };
    const e = estimateCommute(milltown, ucd);
    expect(e.bicycle.minutes).toBeGreaterThan(3);
    expect(e.bicycle.minutes).toBeLessThan(20);
    expect(e.walk).not.toBeNull();
    const far = estimateCommute({ lat: 53.35, lng: -6.3 }, ucd);
    expect(far.walk).toBeNull();
    expect(far.transit.minutes).toBeGreaterThan(e.transit.minutes);
  });
});

describe("costs", () => {
  it("matches the spec's cadence table", () => {
    expect(runsPerDay("*/15 7-22 * * *")).toBe(64);
    expect(runsPerDay("*/20 7-22 * * *")).toBe(48);
    expect(runsPerDay("*/30 7-22 * * *")).toBe(32);
    expect(runsPerDay("0 7-23 * * *")).toBe(17);
    expect(apifyRunCost(10, "fast_lane")).toBeCloseTo(0.0115, 4);
    const t = cadenceTable();
    expect(Math.round(t[0].fastMonthly)).toBe(22);
    expect(Math.round(t[2].fastMonthly)).toBe(11);
    expect(Math.round(t[2].withSweepMonthly)).toBe(16);
  });
  it("Google is free under the cap", () => {
    expect(googleCost("routes", 9_999)).toBe(0);
    expect(googleCost("routes", 12_000)).toBe(10);
  });
});

describe("time", () => {
  it("handles Dublin DST", () => {
    expect(dublinOffsetMinutes(new Date("2026-07-01T12:00:00Z"))).toBe(60);
    expect(dublinOffsetMinutes(new Date("2026-12-01T12:00:00Z"))).toBe(0);
    expect(monthKey(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10"); // 23:30 GMT on Oct 31
    expect(monthKey(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07"); // 00:30 IST on Jul 1
  });
  it("next weekday 08:30 Dublin", () => {
    // Friday 2026-11-20 12:00 UTC → Monday 23rd 08:30 GMT
    expect(nextWeekdayAt(8, 30, new Date("2026-11-20T12:00:00Z")).toISOString()).toBe("2026-11-23T08:30:00.000Z");
    // Summer: Wed 2026-07-01 06:00 UTC (07:00 IST) → same day 08:30 IST = 07:30 UTC
    expect(nextWeekdayAt(8, 30, new Date("2026-07-01T06:00:00Z")).toISOString()).toBe("2026-07-01T07:30:00.000Z");
  });
});

describe("notification formatting", () => {
  const listing = {
    id: 1,
    title: "39 Abbeyfield, Milltown, Dublin 6 <script>",
    url: "https://www.daft.ie/for-rent/x/1",
    area: "Dublin 6",
    monthly_rent: 3900,
    price_is_from: false,
    price_on_application: false,
    beds: 3,
    beds_min: 3,
    beds_max: 3,
    baths: 2,
    property_type: "Apartment",
    image_cover: null,
    score: 70,
  };
  const dests = [{ id: "u", short_name: "UCD" }, { id: "s", short_name: "Sandyford" }];
  const commutes = [
    { destination_id: "u", mode: "transit", minutes: 24, source: "google" },
    { destination_id: "u", mode: "bicycle", minutes: 12, source: "google" },
    { destination_id: "s", mode: "transit", minutes: 31, source: "estimate" },
  ];
  it("builds commute chips", () => {
    expect(commuteChips(dests, commutes)).toEqual(["UCD 🚌 24m · 🚲 12m", "Sandyford 🚌 ~31m · 🚲 ?"]);
  });
  it("escapes HTML and shows per-person", () => {
    const c = telegramCaption(listing, dests, commutes, 1350, "https://app");
    expect(c).toContain("&lt;script&gt;");
    expect(c).toContain("€1,300/person</b> ✅");
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });
  it("parses callback data strictly", () => {
    expect(parseCallbackData("claim:123")).toEqual({ action: "claim", listingId: 123 });
    expect(parseCallbackData("drop:1")).toBeNull();
    expect(parseCallbackData("claim:1;x")).toBeNull();
  });
  it("only notifies fitting listings above the threshold", () => {
    const ctx = { maxPerPerson: 1350, bedsMin: 2, bedsMax: 5, threshold: 50 };
    expect(shouldNotify(listing, ctx)).toBe(true);
    expect(shouldNotify({ ...listing, score: 40 }, ctx)).toBe(false);
    expect(shouldNotify({ ...listing, monthly_rent: 4200 }, ctx)).toBe(false);
    expect(shouldNotify({ ...listing, beds: 1, beds_min: 1, beds_max: 1, monthly_rent: 900 }, ctx)).toBe(false);
  });
});

describe("constant-time secret compare", () => {
  it("works", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(null, "abc")).toBe(false);
  });
});
