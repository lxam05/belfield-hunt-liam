import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { monthKey } from "@/lib/time";

type Db = SupabaseClient<Database>;

/** Total Google calls this month across SKUs. */
export async function googleCallsThisMonth(db: Db, month = monthKey()): Promise<number> {
  const { data } = await db.from("api_usage").select("count").eq("provider", "google").eq("month", month);
  return (data ?? []).reduce((a, r) => a + r.count, 0);
}

/**
 * Reserve one Google call against the hard monthly limit (GOOGLE_MONTHLY_CALL_LIMIT).
 * Returns false when the kill switch is hit; the caller then uses the free estimator.
 * The per-SKU counter is incremented atomically first, so failed calls still count
 * (conservative) and concurrent enrichments can't overshoot by more than one call each.
 */
export async function reserveGoogleCall(db: Db, sku: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const month = monthKey();
  const { error } = await db.rpc("increment_api_usage", { p_provider: "google", p_sku: sku, p_month: month, p_n: 1 });
  if (error) return false;
  const used = await googleCallsThisMonth(db, month);
  if (used > limit) {
    // Over the cap: give the reservation back so the counter reflects real calls.
    await db.rpc("increment_api_usage", { p_provider: "google", p_sku: sku, p_month: month, p_n: -1 });
    return false;
  }
  return true;
}

export async function countUsage(db: Db, provider: string, sku: string, n: number) {
  if (n <= 0) return;
  await db.rpc("increment_api_usage", { p_provider: provider, p_sku: sku, p_month: monthKey(), p_n: n });
}
