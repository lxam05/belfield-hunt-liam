"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

type Run = {
  apify_run_id: string;
  received_at: string;
  items: number;
  new_items: number;
  status: string;
};
type Home = { id: number; title: string; price_text: string | null };
export default function Searches() {
  const [runs, setRuns] = useState<Run[]>([]),
    [homes, setHomes] = useState<Home[]>([]);
  const [selected, setSelected] = useState(""),
    [message, setMessage] = useState("Loading searches…");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/scrape-history" + (selected ? "?run=" + encodeURIComponent(selected) : ""), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        return data;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (selected) setHomes(data);
        else setRuns(data);
        setMessage(data.length ? "" : selected ? "No listings returned." : "No searches yet.");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
  }, [selected]);
  function open(id: string) {
    setSelected(id);
    setHomes([]);
    setMessage("Loading…");
  }
  return (
    <section className="mx-auto max-w-2xl space-y-4 p-5 pb-24">
      <h1>Recent searches</h1>
      {selected && <button onClick={() => open("")}>← All searches</button>}
      {message && <p role="status">{message}</p>}
      {!selected
        ? runs.map((r) => (
            <button
              key={r.apify_run_id}
              className="paper-note block w-full p-4 text-left"
              onClick={() => open(r.apify_run_id)}
            >
              <strong>
                {new Date(r.received_at).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })}
              </strong>
              <span className="block text-sm">
                {r.status === "succeeded" ? r.items + " found · " + r.new_items + " new" : r.status}
              </span>
            </button>
          ))
        : homes.map((h) => (
            <Link key={h.id} className="paper-note block p-3" href={"/map?focus=" + h.id}>
              {h.title}
              <small className="block">{h.price_text}</small>
            </Link>
          ))}
    </section>
  );
}
