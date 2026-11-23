import { z } from "zod";

/**
 * Normalizer for items produced by the Apify Actor `shahidirfan/Daft-ie-Property-Scraper`.
 * Every known quirk is handled here and covered by tests/unit/daft-parse.test.ts.
 */

// ─── Raw item schema (lenient: the Actor's output is not contractually stable) ──
const str = z.string().trim().optional().nullable().catch(null);
const bool = z
  .union([z.boolean(), z.string()])
  .optional()
  .nullable()
  .transform((v) => v === true || v === "true")
  .catch(false);

export const RawDaftItemSchema = z
  .object({
    id: z.union([z.number(), z.string().regex(/^\d+$/)]).transform((v) => Number(v)),
    daftShortcode: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v) => (v == null ? null : String(v)))
      .catch(null),
    title: z.string().trim().min(1),
    price: str,
    propertyType: str,
    numBedrooms: str,
    numBathrooms: str,
    publishDate: str,
    featuredLevel: str,
    category: str,
    sellerName: str,
    sellerPhone: str,
    imageCover: str,
    imageGallery: z.array(z.string()).optional().nullable().catch([]),
    imageCount: z.coerce.number().optional().nullable().catch(null),
    hasVideo: bool,
    hasVirtualTour: bool,
    url: str,
    sourceType: str,
    sourceUrl: str,
  })
  .passthrough();

export type RawDaftItem = z.input<typeof RawDaftItemSchema>;

// ─── Individual parsers ─────────────────────────────────────────────────────

/** Quirk 1: `https://www.daft.ie/for-sale/for-rent/<slug>/<id>` → `/for-rent/<slug>/<id>`. */
export function normalizeDaftUrl(raw: string | null | undefined, id?: number): string {
  if (!raw) return id ? `https://www.daft.ie/for-rent/listing/${id}` : "https://www.daft.ie";
  let url = raw.trim();
  if (url.startsWith("/")) url = `https://www.daft.ie${url}`;
  url = url.replace(/^http:\/\//, "https://");
  url = url.replace(/\/\/daft\.ie\//, "//www.daft.ie/");
  url = url.replace("/for-sale/for-rent/", "/for-rent/");
  return url;
}

export interface ParsedPrice {
  monthlyRent: number | null;
  priceIsFrom: boolean;
  priceOnApplication: boolean;
}

/** Quirk 3: monthly as-is; weekly ×52/12; "From €X" flag; non-numeric → POA. */
export function parsePrice(text: string | null | undefined): ParsedPrice {
  const t = (text ?? "").trim();
  const isFrom = /^from\b/i.test(t);
  const m = t.match(/€\s*([\d,]+(?:\.\d+)?)/) ?? t.match(/([\d][\d,]*(?:\.\d+)?)/);
  if (!m) return { monthlyRent: null, priceIsFrom: false, priceOnApplication: true };
  const amount = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { monthlyRent: null, priceIsFrom: false, priceOnApplication: true };
  }
  const weekly = /\b(per\s+week|\/\s*week|weekly|p\/?w|pw)\b/i.test(t);
  const monthly = weekly ? Math.round((amount * 52) / 12) : Math.round(amount);
  return { monthlyRent: monthly, priceIsFrom: isFrom, priceOnApplication: false };
}

export interface ParsedBeds {
  beds: number | null;
  bedsMin: number | null;
  bedsMax: number | null;
  isDevelopment: boolean;
}

/** Quirk 4: "3 Bed" → 3; "1, 2 & 3 bed" → 1..3 development; "Studio" → 1. */
export function parseBeds(text: string | null | undefined): ParsedBeds {
  const t = (text ?? "").trim();
  const nums = (t.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 20);
  const studio = /studio/i.test(t);
  if (studio && nums.length === 0) nums.push(1);
  if (nums.length === 0) return { beds: null, bedsMin: null, bedsMax: null, isDevelopment: false };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (nums.length > 1 && min !== max) {
    return { beds: null, bedsMin: min, bedsMax: max, isDevelopment: true };
  }
  return { beds: min, bedsMin: min, bedsMax: min, isDevelopment: false };
}

export function parseBaths(text: string | null | undefined): number | null {
  const m = (text ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Irish Eircode (routing key + unique identifier). */
export const EIRCODE_RE = /\b([AC-FHKNPRTV-Y]\d{2}|D6W)\s?([0-9AC-FHKNPRTV-Y]{4})\b/;
const EIRCODE_AT_END_RE = new RegExp(`${EIRCODE_RE.source}[\\s.]*$`);

/** Quirk 2 helper: returns a normalized Eircode ("A94 FD70") if the title ends with one. */
export function extractEircode(title: string): string | null {
  const m = title.trim().toUpperCase().match(EIRCODE_AT_END_RE);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Eircode routing keys covering the search area → human area label. */
const ROUTING_KEY_AREAS: Record<string, string> = {
  D04: "Dublin 4",
  D06: "Dublin 6",
  D6W: "Dublin 6W",
  D14: "Dublin 14",
  D16: "Dublin 16",
  D18: "Dublin 18",
  D08: "Dublin 8",
  D02: "Dublin 2",
  D12: "Dublin 12",
  A94: "Blackrock",
  A96: "Dún Laoghaire",
  D24: "Dublin 24",
};

/** Known suburbs in/around the search area (used when no "Dublin N" postcode is present). */
export const KNOWN_SUBURBS = [
  "Ballsbridge",
  "Donnybrook",
  "Sandymount",
  "Ringsend",
  "Irishtown",
  "Ranelagh",
  "Rathmines",
  "Rathgar",
  "Milltown",
  "Terenure",
  "Harold's Cross",
  "Clonskeagh",
  "Goatstown",
  "Dundrum",
  "Churchtown",
  "Windy Arbour",
  "Kilmacud",
  "Stillorgan",
  "Mount Merrion",
  "Booterstown",
  "Blackrock",
  "Monkstown",
  "Dún Laoghaire",
  "Dun Laoghaire",
  "Sandyford",
  "Leopardstown",
  "Foxrock",
  "Cabinteely",
  "Ballinteer",
  "Rathfarnham",
  "Knocklyon",
  "Firhouse",
  "Templeogue",
  "Ballyboden",
  "Belfield",
  "Merrion",
  "Stepaside",
  "Carrickmines",
  "Deansgrange",
  "Glenageary",
  "Kilmacud",
  "Mount Anville",
  "Roebuck",
  "Beaumont Woods",
];

export interface ParsedArea {
  /** Postcode district ("Dublin 6W") if known, else the suburb, else "Co. Dublin". */
  area: string;
  suburb: string | null;
}

/** Quirk 6: `search.location` is unreliable, derive area from the title. */
export function deriveArea(title: string): ParsedArea {
  const t = title.replace(/\s+/g, " ").trim();
  const postcode = t.match(/\bDublin\s?(\d{1,2})\s?(W)?\b/i);
  const parts = t
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const known = KNOWN_SUBURBS.map((s) => s.toLowerCase());
  const reversed = [...parts].reverse();
  // Prefer a comma-separated part that IS a suburb ("…, Sandyford, Dublin 18"), scanning from
  // the end, over a suburb name embedded in a street ("Kilmacud Road Upper").
  let suburb: string | null =
    reversed.find((p) => known.includes(p.toLowerCase())) ??
    (() => {
      for (const p of reversed) {
        const hit = KNOWN_SUBURBS.find((s) =>
          new RegExp(`\\b${s.toLowerCase()}\\b`).test(p.toLowerCase()),
        );
        if (hit) return hit;
      }
      return null;
    })();
  if (suburb)
    suburb = KNOWN_SUBURBS.find((s) => s.toLowerCase() === suburb!.toLowerCase()) ?? suburb;
  if (suburb === "Dun Laoghaire") suburb = "Dún Laoghaire";
  if (!suburb) {
    // Second-to-last part before a "Dublin N"/"Co. Dublin"/eircode tail is usually the suburb.
    const cleaned = parts.filter(
      (p) =>
        !/^(co\.?\s*)?dublin(\s?\d{1,2}w?)?$/i.test(p) &&
        !EIRCODE_RE.test(p.toUpperCase()) &&
        !/^ireland$/i.test(p),
    );
    if (cleaned.length >= 2) suburb = cleaned[cleaned.length - 1];
  }
  if (postcode) {
    const district = `Dublin ${Number(postcode[1])}${postcode[2] ? "W" : ""}`;
    return { area: district, suburb };
  }
  const eir = extractEircode(t);
  if (eir) {
    const key = eir.slice(0, 3).toUpperCase();
    if (ROUTING_KEY_AREAS[key]) return { area: suburb ?? ROUTING_KEY_AREAS[key], suburb };
  }
  return { area: suburb ?? "Co. Dublin", suburb };
}

function parseDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── Full normalization ─────────────────────────────────────────────────────

export interface NormalizedListing {
  id: number;
  daft_shortcode: string | null;
  url: string;
  raw_url: string | null;
  title: string;
  area: string;
  suburb: string | null;
  eircode: string | null;
  monthly_rent: number | null;
  price_text: string | null;
  price_is_from: boolean;
  price_on_application: boolean;
  beds: number | null;
  beds_min: number | null;
  beds_max: number | null;
  baths: number | null;
  property_type: string | null;
  is_development: boolean;
  seller_name: string | null;
  seller_phone: string | null;
  image_cover: string | null;
  images: string[];
  image_count: number;
  has_video: boolean;
  has_virtual_tour: boolean;
  featured_level: string | null;
  published_at: string | null;
  raw: Record<string, unknown>;
}

export function normalizeItem(input: unknown): NormalizedListing {
  const item = RawDaftItemSchema.parse(input);
  const price = parsePrice(item.price);
  const beds = parseBeds(item.numBedrooms);
  const { area, suburb } = deriveArea(item.title);
  const images = (item.imageGallery ?? []).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  const propertyType = item.propertyType ?? null;
  const isDevelopment = beds.isDevelopment || /^apartments$|^houses$/i.test(propertyType ?? "");
  const phone = item.sellerPhone?.replace(/[^\d+]/g, "") || null;

  return {
    id: item.id,
    daft_shortcode: item.daftShortcode ?? `2${item.id}`,
    url: normalizeDaftUrl(item.url, item.id),
    raw_url: item.url ?? null,
    title: item.title,
    area,
    suburb,
    eircode: extractEircode(item.title),
    monthly_rent: price.monthlyRent,
    price_text: item.price ?? null,
    price_is_from: price.priceIsFrom,
    price_on_application: price.priceOnApplication,
    beds: beds.beds,
    beds_min: beds.bedsMin,
    beds_max: beds.bedsMax,
    baths: parseBaths(item.numBathrooms),
    property_type: propertyType,
    is_development: isDevelopment,
    seller_name: item.sellerName ?? null,
    seller_phone: phone && phone.length >= 6 ? phone : null,
    image_cover: item.imageCover ?? images[0] ?? null,
    images,
    image_count: item.imageCount ?? images.length,
    has_video: item.hasVideo,
    has_virtual_tour: item.hasVirtualTour,
    featured_level: item.featuredLevel ?? null,
    published_at: parseDate(item.publishDate),
    raw: input as Record<string, unknown>,
  };
}

export interface NormalizeResult {
  listings: NormalizedListing[];
  errors: { index: number; message: string }[];
}

/** Normalize a whole dataset; quirk 5: dedupe on id (last occurrence wins). */
export function normalizeItems(items: unknown[]): NormalizeResult {
  const byId = new Map<number, NormalizedListing>();
  const errors: NormalizeResult["errors"] = [];
  items.forEach((it, index) => {
    try {
      const n = normalizeItem(it);
      byId.set(n.id, n);
    } catch (e) {
      errors.push({ index, message: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
  });
  return { listings: [...byId.values()], errors };
}
