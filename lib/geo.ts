export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough Dublin bounding box used to sanity-check geocoder results. */
export const DUBLIN_BBOX = { minLat: 53.15, maxLat: 53.5, minLng: -6.55, maxLng: -5.95 };

export function inDublin(p: LatLng): boolean {
  return p.lat >= DUBLIN_BBOX.minLat && p.lat <= DUBLIN_BBOX.maxLat && p.lng >= DUBLIN_BBOX.minLng && p.lng <= DUBLIN_BBOX.maxLng;
}

/** Approximate centroids, last-resort geocode (precision 'area'). */
export const AREA_CENTROIDS: Record<string, LatLng> = {
  "Dublin 4": { lat: 53.3275, lng: -6.2285 },
  "Dublin 6": { lat: 53.3175, lng: -6.2585 },
  "Dublin 6W": { lat: 53.311, lng: -6.293 },
  "Dublin 14": { lat: 53.2965, lng: -6.25 },
  "Dublin 16": { lat: 53.282, lng: -6.265 },
  "Dublin 18": { lat: 53.2625, lng: -6.2005 },
  Stillorgan: { lat: 53.2885, lng: -6.1985 },
  "Mount Merrion": { lat: 53.2995, lng: -6.2065 },
  Booterstown: { lat: 53.3075, lng: -6.1965 },
  Blackrock: { lat: 53.3015, lng: -6.1778 },
  Sandyford: { lat: 53.2755, lng: -6.2235 },
  Leopardstown: { lat: 53.2665, lng: -6.1955 },
  Dundrum: { lat: 53.2925, lng: -6.2455 },
  Milltown: { lat: 53.3105, lng: -6.2495 },
  Ranelagh: { lat: 53.3255, lng: -6.2565 },
  Rathmines: { lat: 53.3225, lng: -6.2655 },
  Donnybrook: { lat: 53.3215, lng: -6.2365 },
  Ballsbridge: { lat: 53.3295, lng: -6.2305 },
  Clonskeagh: { lat: 53.3115, lng: -6.2335 },
  Goatstown: { lat: 53.2975, lng: -6.2335 },
  "Dún Laoghaire": { lat: 53.2935, lng: -6.1355 },
  "Co. Dublin": { lat: 53.3, lng: -6.22 },
};
