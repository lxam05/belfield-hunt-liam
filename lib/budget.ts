/**
 * Per-person budget rules. Daft filters on total rent; the group's real rule is per person.
 * Assumes one person per bedroom.
 */

export interface RentInfo {
  monthly_rent: number | null;
  beds: number | null;
  beds_min: number | null;
  beds_max: number | null;
}

/** Bedrooms used for the exact rule. Developments ("1, 2 & 3 bed", "From €X") use the
 * smallest unit, which is what the "From" price refers to. */
export function effectiveBeds(l: Pick<RentInfo, "beds" | "beds_min">): number | null {
  return l.beds ?? l.beds_min ?? null;
}

export function perPersonRent(monthlyRent: number | null, beds: number | null): number | null {
  if (monthlyRent == null || beds == null || beds <= 0) return null;
  return Math.round(monthlyRent / beds);
}

/** Exact in-app rule: monthlyRent / beds ≤ maxPerPerson. Unknown price/beds → false. */
export function fitsBudget(l: RentInfo, maxPerPerson: number): boolean {
  const pp = perPersonRent(l.monthly_rent, effectiveBeds(l));
  return pp != null && pp <= maxPerPerson;
}

export interface GroupSizeCell {
  groupSize: number;
  /** Rent per person if this many people share it, or null if not enough bedrooms / no price. */
  perPerson: number | null;
  /** Enough bedrooms for one-person-per-room. */
  roomsOk: boolean;
  fits: boolean;
}

/** Per-person cost for each possible group size (default 2–5), highlighting cells that fit. */
export function groupSizeTable(
  l: RentInfo,
  maxPerPerson: number,
  sizes: { min: number; max: number } = { min: 2, max: 5 },
): GroupSizeCell[] {
  const beds = l.beds ?? l.beds_max ?? l.beds_min;
  const cells: GroupSizeCell[] = [];
  for (let n = sizes.min; n <= sizes.max; n++) {
    const roomsOk = beds != null && n <= beds;
    const perPerson = l.monthly_rent != null && roomsOk ? Math.round(l.monthly_rent / n) : null;
    cells.push({
      groupSize: n,
      perPerson,
      roomsOk,
      fits: perPerson != null && perPerson <= maxPerPerson,
    });
  }
  return cells;
}

/** Daft total-rent cap for a bedroom count. */
export function totalCapForBeds(beds: number, maxPerPerson: number): number {
  return beds * maxPerPerson;
}

export function formatEuro(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("en-IE")}`;
}
