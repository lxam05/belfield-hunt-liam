import { describe, expect, it } from "vitest";
import {
  buildFastLaneInput,
  buildSearchUrl,
  buildSweepInput,
  buildSweepUrls,
} from "@/lib/daft/buildUrls";
import { DEFAULT_SEARCH_SETTINGS } from "@/lib/config/defaults";

describe("Daft URL builder", () => {
  it("reproduces the four nightly sweep URLs with exact caps", () => {
    const base = `https://www.daft.ie/property-for-rent/dublin?`;
    expect(buildSweepUrls()).toEqual([
      `${base}numBeds_from=2&numBeds_to=2&rentalPrice_to=2599&sort=publishDateDesc`,
      `${base}numBeds_from=3&numBeds_to=3&rentalPrice_to=3899&sort=publishDateDesc`,
      `${base}numBeds_from=4&numBeds_to=4&rentalPrice_to=5199&sort=publishDateDesc`,
      `${base}numBeds_from=5&numBeds_to=5&rentalPrice_to=6499&sort=publishDateDesc`,
    ]);
  });

  it("builds Actor inputs", () => {
    expect(buildFastLaneInput()).toEqual({
      propertyUrls: buildSweepUrls(),
      results_wanted: 10,
      max_pages: 1,
      proxyConfiguration: { useApifyProxy: true },
    });
    const sweep = buildSweepInput();
    expect(sweep.results_wanted).toBe(300);
    expect(sweep.max_pages).toBe(10);
    expect(sweep.propertyUrls).toHaveLength(4);
    expect(sweep.proxyConfiguration).toEqual({ useApifyProxy: true });
  });

  it("follows edited settings", () => {
    const s = {
      ...DEFAULT_SEARCH_SETTINGS,
      maxPerPerson: 1200,
      bedsMin: 3,
      bedsMax: 4,
      locationSlugs: ["dublin-4-dublin"],
    };
    expect(buildSweepUrls(s)[0]).toBe(
      "https://www.daft.ie/property-for-rent/dublin-4-dublin?numBeds_from=3&numBeds_to=3&rentalPrice_to=3599&sort=publishDateDesc",
    );
    expect(buildSweepUrls(s)).toHaveLength(2);
  });

  it("validates slugs", () => {
    expect(() => buildSearchUrl({ slugs: [] })).toThrow();
    expect(() => buildSearchUrl({ slugs: ["dublin 4"] })).toThrow();
    expect(() => buildSearchUrl({ slugs: ["x&location=evil"] })).toThrow();
  });
});
