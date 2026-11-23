import type { RentInfo } from "./budget";

export type Bedrooms = Pick<RentInfo, "beds" | "beds_min" | "beds_max">;
export const bedroomOptions = [2, 3, 4] as const;

export function readBedrooms(value: string | null) {
  const parts = value?.split(",");
  return bedroomOptions.filter((n) => parts?.includes(String(n)));
}

export function matchesBedrooms(home: Bedrooms, selected: readonly number[]) {
  if (!selected.length) return true;
  if (home.beds != null) return selected.includes(home.beds);
  const min = home.beds_min ?? home.beds_max;
  const max = home.beds_max ?? home.beds_min;
  return min != null && max != null && selected.some((n) => n >= min && n <= max);
}
