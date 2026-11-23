import { DEFAULT_SEARCH_SETTINGS, type SearchSettings } from "@/lib/config/defaults";

/**
 * Daft search URL builder. First slug goes in the path, the rest as repeated `location=` params.
 * Daft filters on TOTAL rent, so caps are `beds × maxPerPerson` (exact rule applied in-app).
 */

export interface SearchUrlInput {
  slugs: string[];
  bedsFrom?: number;
  bedsTo?: number;
  priceTo?: number;
  sort?: "publishDateDesc" | "priceAsc" | "priceDesc";
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function buildSearchUrl({
  slugs,
  bedsFrom,
  bedsTo,
  priceTo,
  sort = "publishDateDesc",
}: SearchUrlInput): string {
  const clean = slugs.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) throw new Error("At least one Daft location slug is required");
  const bad = clean.find((s) => !isValidSlug(s));
  if (bad) throw new Error(`Invalid Daft location slug: ${bad}`);
  const [first, ...rest] = clean;
  // Build manually so the order of params is stable and matches the verified URLs exactly.
  const params: string[] = rest.map((s) => `location=${s}`);
  if (bedsFrom != null) params.push(`numBeds_from=${bedsFrom}`);
  if (bedsTo != null) params.push(`numBeds_to=${bedsTo}`);
  if (priceTo != null) params.push(`rentalPrice_to=${Math.round(priceTo)}`);
  if (sort) params.push(`sort=${sort}`);
  return `https://www.daft.ie/property-for-rent/${first}${params.length ? `?${params.join("&")}` : ""}`;
}

/** Nightly sweep: one URL per bedroom count with its exact total cap. */
export function buildSweepUrls(s: SearchSettings = DEFAULT_SEARCH_SETTINGS): string[] {
  const urls: string[] = [];
  for (let beds = s.bedsMin; beds <= s.bedsMax; beds++) {
    urls.push(
      buildSearchUrl({
        slugs: s.locationSlugs,
        bedsFrom: beds,
        bedsTo: beds,
        priceTo: beds * s.maxPerPerson - 1,
      }),
    );
  }
  return urls;
}

export interface ActorInput {
  propertyUrls: string[];
  results_wanted: number;
  max_pages: number;
  proxyConfiguration: { useApifyProxy: true };
}

export function buildFastLaneInput(s: SearchSettings = DEFAULT_SEARCH_SETTINGS): ActorInput {
  return {
    propertyUrls: buildSweepUrls(s),
    results_wanted: s.fastLaneResultsWanted,
    max_pages: 1,
    // Automatic proxy: DATACENTER group is rejected on the Free plan; RESIDENTIAL costs $8/GB.
    proxyConfiguration: { useApifyProxy: true },
  };
}

export function buildSweepInput(s: SearchSettings = DEFAULT_SEARCH_SETTINGS): ActorInput {
  return {
    propertyUrls: buildSweepUrls(s),
    results_wanted: s.sweepResultsWanted,
    max_pages: 10,
    proxyConfiguration: { useApifyProxy: true },
  };
}
