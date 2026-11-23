"use client";
import { useEffect, useMemo, useState } from "react";
import { firstSeenBetween } from "@/lib/listing-review";
import type { Bedrooms } from "@/lib/bedroom-filter";
import type { Row } from "@/lib/store/hooks";

export type Run = {
  apify_run_id: string;
  received_at: string;
  finished_at: string | null;
  items: number;
  new_items: number;
  status: string;
};
export type Home = Bedrooms & { id: number; title: string; price_text: string | null };

export function useSearchData<T>(url: string | null, refresh = false) {
  const [result, setResult] = useState<{ url: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    async function load(path: string) {
      try {
        const res = await fetch(path, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load search results.");
        if (!controller.signal.aborted) setResult({ url: path, data });
      } catch (e) {
        if (!controller.signal.aborted)
          setResult({
            url: path,
            error: e instanceof Error ? e.message : "Could not load search results.",
          });
      }
    }
    void load(url);
    const timer = refresh ? window.setInterval(() => void load(url), 60_000) : undefined;
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [url, refresh]);
  return result?.url === url ? result : null;
}

export function useSearchResults(selected: string, onlyNew: boolean) {
  const latest = useSearchData<Run | null>(
    onlyNew && !selected ? "/api/scrape-history?latest=1" : null,
    true,
  );
  const runId = selected || (latest?.data?.new_items ? latest.data.apify_run_id : "");
  const results = useSearchData<{ run: Run; homes: Home[] }>(
    runId ? "/api/scrape-history?details=1&run=" + encodeURIComponent(runId) : null,
  );
  const data = results?.data;
  const ids = useMemo(() => new Set(data?.homes.map((home) => home.id)), [data]);
  const run = data?.run;
  const isNew = useMemo(
    () => (row: Row) =>
      !!run?.finished_at &&
      run.status === "succeeded" &&
      run.new_items > 0 &&
      ids.has(row.listing.id) &&
      firstSeenBetween(
        row.listing.first_seen_at,
        Date.parse(run.received_at),
        Date.parse(run.finished_at),
      ),
    [run, ids],
  );
  return {
    homes: data?.homes,
    isNew,
    runId,
    error: latest?.error || results?.error,
    loading: (onlyNew && !selected && !latest) || (!!runId && !results),
  };
}
