import { haversineM, inDublin, type LatLng } from "./geo";
import type { ListingLite } from "./store/types";

export const CAMPUS_ID = "00000000-0000-4000-8000-0000000000d1";
export const BELFIELD = { lat: 53.3075, lng: -6.2236 };
export const SEARCH_RADIUS_M = 5000;
export const RENT_LIMIT = 1300;

type SearchListing = Pick<
  ListingLite,
  | "lat"
  | "lng"
  | "geocode_precision"
  | "beds"
  | "monthly_rent"
  | "price_is_from"
  | "price_on_application"
>;

export function campusPoint(destinations: (LatLng & { id: string })[]) {
  return destinations.find((d) => d.id === CAMPUS_ID) ?? BELFIELD;
}

export function assessRental(l: SearchListing, campus: LatLng, cap = RENT_LIMIT) {
  const point = l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null;
  const located =
    point &&
    inDublin(point) &&
    ["eircode", "rooftop", "street"].includes(l.geocode_precision ?? "");
  const distance = located ? haversineM(point, campus) : null;
  const rent =
    l.beds &&
    l.beds > 0 &&
    l.monthly_rent &&
    l.monthly_rent > 0 &&
    !l.price_is_from &&
    !l.price_on_application
      ? l.monthly_rent / l.beds
      : null;
  const matches =
    distance != null &&
    distance <= SEARCH_RADIUS_M &&
    rent != null &&
    rent < Math.min(cap, RENT_LIMIT);
  return { distance, rent, matches };
}
