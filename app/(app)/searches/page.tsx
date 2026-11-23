"use client";

import { useMemo } from "react";
import { BedroomFilter } from "@/components/app/bedroom-filter";
import { matchesBedrooms, readBedrooms } from "@/lib/bedroom-filter";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isUnreviewed, type ReviewFilter } from "@/lib/listing-review";
import { useRows } from "@/lib/store/hooks";
import { useSearchResults, useSearchData, type Run } from "@/components/app/use-search-results";

function updateSearch(run: string, filter: ReviewFilter, counts?: number[]) {
  const url = new URL(window.location.href);
  if (run) url.searchParams.set("run", run);
  else url.searchParams.delete("run");
  if (counts?.length) url.searchParams.set("beds", counts.join(","));
  else if (counts) url.searchParams.delete("beds");
  url.searchParams.set("show", filter);
  window.history.pushState(null, "", url);
}

export default function Searches() {
  const params = useSearchParams();
  const bedsParam = params.get("beds");
  const bedrooms = useMemo(() => readBedrooms(bedsParam), [bedsParam]);
  const selected = params.get("run") ?? "";
  const show = params.get("show");
  const filter = show === "new" || show === "unreviewed" ? show : "all";
  const history = useSearchData<Run[]>("/api/scrape-history");
  const results = useSearchResults(selected, filter === "new");
  const rows = useRows();
  const byId = useMemo(() => new Map(rows.map((r) => [r.listing.id, r])), [rows]);
  const homes = selected ? (results.homes ?? []) : rows.map((r) => r.listing);
  const visible = homes
    .filter((home) => {
      if (!matchesBedrooms(home, bedrooms)) return false;
      if (filter === "all") return true;
      const row = byId.get(home.id);
      if (!row) return false;
      if (filter === "unreviewed") return isUnreviewed(row);
      return results.isNew(row);
    })
    .sort((a, b) =>
      (byId.get(b.id)?.listing.first_seen_at ?? "").localeCompare(
        byId.get(a.id)?.listing.first_seen_at ?? "",
      ),
    );
  const { error, loading } = results;

  return (
    <section className="mx-auto max-w-2xl space-y-4 p-5 pb-24">
      <h1>Searches</h1>
      <label className="block text-sm font-medium">
        Search
        <select
          className="bg-background mt-1 block w-full rounded border p-2"
          value={selected}
          onChange={(e) => updateSearch(e.target.value, filter)}
        >
          <option value="">All searches</option>
          {history?.data?.map((r) => (
            <option key={r.apify_run_id} value={r.apify_run_id}>
              {new Date(r.received_at).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })} ·{" "}
              {r.status === "succeeded" ? r.items + " found · " + r.new_items + " new" : r.status}
            </option>
          ))}
        </select>
      </label>
      {history?.error && <p role="alert">{history.error}</p>}
      <div className="flex flex-wrap gap-2" aria-label="Filter listings" role="group">
        {(["all", "new", "unreviewed"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={value === filter}
            className="aria-pressed:bg-primary aria-pressed:text-primary-foreground rounded border px-3 py-2 text-sm"
            onClick={() => updateSearch(selected, value)}
          >
            {value === "all"
              ? "All found"
              : value === "new"
                ? selected
                  ? "New in this search"
                  : "New in latest search"
                : "Unreviewed"}
          </button>
        ))}
      </div>
      <BedroomFilter
        selected={bedrooms}
        onChange={(counts) => updateSearch(selected, filter, counts)}
      />
      {filter === "unreviewed" && (
        <p className="text-muted-foreground text-sm">
          Listings nobody in your group has acted on yet.
        </p>
      )}
      <p role="status">
        {error ||
          (loading
            ? "Loading search results…"
            : visible.length
              ? visible.length + (visible.length === 1 ? " listing" : " listings")
              : "No listings in this view.")}
      </p>
      {!error &&
        !loading &&
        visible.map((h) => {
          const row = byId.get(h.id);
          const href =
            row && row.listing.status !== "gone"
              ? "/map?focus=" +
                h.id +
                (filter === "new"
                  ? "&show=all&new=1" + (selected ? "&run=" + encodeURIComponent(selected) : "")
                  : !selected && !row.pipeline?.hidden
                    ? "&show=" + filter
                    : "&show=all") +
                (bedrooms.length ? "&beds=" + bedrooms.join(",") : "")
              : "https://www.daft.ie/for-rent/listing/" + h.id;
          return (
            <Link key={h.id} className="paper-note block p-3" href={href}>
              {h.title}
              <small className="block">{h.price_text}</small>
            </Link>
          );
        })}
    </section>
  );
}
