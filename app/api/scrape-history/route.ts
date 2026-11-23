import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchDatasetItems } from "@/lib/apify/provision";
import { normalizeItems } from "@/lib/daft/parse";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;
  const params = new URL(request.url).searchParams;
  const id = params.get("run");
  const runs = supabaseAdmin().from("scrape_runs");
  const fields = "apify_run_id,received_at,finished_at,items,new_items,status";
  if (params.has("latest")) {
    const { data, error } = await runs
      .select(fields)
      .eq("status", "succeeded")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return error
      ? NextResponse.json({ error: "Could not load the latest search." }, { status: 503 })
      : NextResponse.json(data);
  }
  if (!id) {
    const { data, error } = await runs
      .select(fields)
      .order("received_at", { ascending: false })
      .limit(100);
    return error
      ? NextResponse.json({ error: "Could not load searches." }, { status: 503 })
      : NextResponse.json(data);
  }
  const { data } = await runs.select(`dataset_id,${fields}`).eq("apify_run_id", id).maybeSingle();
  const token = env().APIFY_TOKEN;
  if (!data?.dataset_id || !token)
    return NextResponse.json(
      { error: "Results are unavailable for this search." },
      { status: 404 },
    );
  try {
    const { listings } = normalizeItems(await fetchDatasetItems(token, data.dataset_id));
    const homes = listings.map(({ id, title, price_text, beds, beds_min, beds_max }) => ({
      id,
      title,
      price_text,
      beds,
      beds_min,
      beds_max,
    }));
    if (!params.has("details")) return NextResponse.json(homes);
    const { apify_run_id, received_at, finished_at, items, new_items, status } = data;
    return NextResponse.json({
      run: { apify_run_id, received_at, finished_at, items, new_items, status },
      homes,
    });
  } catch {
    return NextResponse.json(
      { error: "The saved scraper results could not be loaded." },
      { status: 503 },
    );
  }
}
