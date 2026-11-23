"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useSearchSettings } from "@/lib/store/hooks";
import { GOOGLE_SKUS, SWEEP_MONTHLY_ESTIMATE, apifyRunCost, googleCost, runsPerDay, type GoogleSku } from "@/lib/costs";
import { formatAgo, monthKey } from "@/lib/time";
import type { Database } from "@/lib/supabase/database.types";
import { useNow } from "./bits";

type Run = Database["public"]["Tables"]["scrape_runs"]["Row"];
type Usage = Database["public"]["Tables"]["api_usage"]["Row"];
type Event = Database["public"]["Tables"]["events"]["Row"];

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn("bg-card rounded-xl border p-3", warn && "border-amber-400")}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

/** Month-to-date spend from real counters (api_usage, scrape_runs) + health panel. */
export function CostsView() {
  const search = useSearchSettings();
  const [runs, setRuns] = useState<Run[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loaded, setLoaded] = useState(false);
  const month = monthKey();
  const now = useNow();

  async function load() {
    const sb = supabaseBrowser();
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const [r, u, e] = await Promise.all([
      sb.from("scrape_runs").select("*").gte("received_at", new Date(start.getTime() - 864e5).toISOString()).order("received_at", { ascending: false }).limit(2000),
      sb.from("api_usage").select("*").eq("month", month),
      sb.from("events").select("*").order("at", { ascending: false }).limit(40),
    ]);
    setRuns((r.data ?? []).filter((x) => monthKey(new Date(x.received_at)) === month));
    setUsage(u.data ?? []);
    setEvents(e.data ?? []);
    setLoaded(true);
  }
  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const count = (provider: string, sku: string) => usage.find((u) => u.provider === provider && u.sku === sku)?.count ?? 0;
  const ok = runs.filter((r) => r.status === "succeeded");
  const results = ok.reduce((a, r) => a + r.items, 0);
  const apifySpend = ok.reduce((a, r) => a + Number(r.cost_usd), 0);
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedApify = day > 0 ? (apifySpend / day) * daysInMonth : 0;
  const modelMonthly = runsPerDay(search.fastLaneCron) * 30 * apifyRunCost(search.fastLaneResultsWanted, "fast_lane") + SWEEP_MONTHLY_ESTIMATE;
  const googleTotal = Object.keys(GOOGLE_SKUS).reduce((a, k) => a + count("google", k), 0);
  const googleSpend = (Object.keys(GOOGLE_SKUS) as GoogleSku[]).reduce((a, k) => a + googleCost(k, count("google", k)), 0);
  const limit = Number(process.env.NEXT_PUBLIC_GOOGLE_LIMIT_HINT) || 8000;

  const lastOk = ok[0];
  const lastWebhook = events.find((e) => e.kind === "apify.webhook");
  const failures = runs.filter((r) => r.status === "failed" || r.status === "apify_failed");
  const errors = events.filter((e) => e.level !== "info").slice(0, 10);
  const staleH = lastOk ? (now.getTime() - new Date(lastOk.received_at).getTime()) / 36e5 : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-3 pt-3 pb-28">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" /> Settings
        </Link>
        <h1 className="ml-2 text-lg font-semibold">Costs & health · {month}</h1>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Apify (month to date)</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Runs" value={String(ok.length)} sub={`${runs.filter((r) => r.kind === "manual").length} manual`} />
          <Stat label="Results" value={String(results)} sub={`${ok.reduce((a, r) => a + r.new_items, 0)} new listings`} />
          <Stat label="Spend so far" value={`$${apifySpend.toFixed(2)}`} sub={`projected ≈ $${projectedApify.toFixed(2)}`} />
          <Stat label="Model for cadence" value={`≈ $${modelMonthly.toFixed(0)}/mo`} sub={search.fastLaneCron} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Google (month to date)</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(GOOGLE_SKUS) as GoogleSku[]).map((k) => (
            <Stat key={k} label={GOOGLE_SKUS[k].label} value={String(count("google", k))} sub={`free cap ${GOOGLE_SKUS[k].freeCap.toLocaleString()}`} warn={count("google", k) > GOOGLE_SKUS[k].freeCap * 0.8} />
          ))}
          <Stat label="All Google calls" value={String(googleTotal)} sub={`kill switch at GOOGLE_MONTHLY_CALL_LIMIT (default ${limit})`} warn={googleTotal > limit * 0.8} />
          <Stat label="Google spend" value={`$${googleSpend.toFixed(2)}`} sub="$0 while under the free caps" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Health</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Last successful run" value={lastOk ? formatAgo(lastOk.received_at) : loaded ? "never" : "…"} sub={lastOk ? `${lastOk.kind} · ${lastOk.items} items` : undefined} warn={staleH == null || staleH > 2} />
          <Stat label="Last webhook" value={lastWebhook ? formatAgo(lastWebhook.at) : "—"} sub={lastWebhook?.message} />
          <Stat label="Failures this month" value={String(failures.length)} warn={failures.length > 0} sub={failures[0]?.error?.slice(0, 60) ?? undefined} />
        </div>
        {staleH != null && staleH > 2 && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            No successful scrape for {Math.round(staleH)} h. Outside 07:00–23:00 that&apos;s expected; otherwise check Apify credits and the webhook (docs/SETUP.md → Troubleshooting).
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Kind</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Items</th>
                <th className="p-2 text-right">New</th>
                <th className="p-2 text-right">Notified</th>
                <th className="p-2 text-right">$</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 25).map((r) => (
                <tr key={r.apify_run_id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{formatAgo(r.received_at)}</td>
                  <td className="p-2">{r.kind}</td>
                  <td className={cn("p-2", r.status !== "succeeded" && "text-red-600")} title={r.error ?? undefined}>
                    {r.status}
                  </td>
                  <td className="p-2 text-right tabular-nums">{r.items}</td>
                  <td className="p-2 text-right tabular-nums">{r.new_items}</td>
                  <td className="p-2 text-right tabular-nums">{r.notified}</td>
                  <td className="p-2 text-right tabular-nums">{Number(r.cost_usd).toFixed(3)}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground p-3 text-center">
                    No runs this month yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {errors.length > 0 && (
          <ul className="space-y-1 text-xs">
            {errors.map((e) => (
              <li key={e.id} className={e.level === "error" ? "text-red-600" : "text-amber-700 dark:text-amber-300"}>
                {formatAgo(e.at)} · {e.kind}: {e.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
