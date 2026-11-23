import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchDatasetItems } from "@/lib/apify/provision";
import { normalizeItems } from "@/lib/daft/parse";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;
  const id = new URL(request.url).searchParams.get("run");
  const runs = supabaseAdmin().from("scrape_runs");
  if (!id) {
    const { data, error } = await runs
      .select("apify_run_id,received_at,finished_at,items,new_items,status")
      .order("received_at", { ascending: false })
      .limit(100);
    return error
      ? NextResponse.json({ error: "Could not load searches." }, { status: 503 })
      : NextResponse.json(data);
  }
  const { data } = await runs.select("dataset_id").eq("apify_run_id", id).maybeSingle();
  const token = env().APIFY_TOKEN;
  if (!data?.dataset_id || !token)
    return NextResponse.json(
      { error: "Results are unavailable for this search." },
      { status: 404 },
    );
  try {
    const { listings } = normalizeItems(await fetchDatasetItems(token, data.dataset_id));
    return NextResponse.json(
      listings.map(({ id, title, price_text }) => ({ id, title, price_text })),
    );
  } catch {
    return NextResponse.json(
      { error: "The saved scraper results could not be loaded." },
      { status: 503 },
    );
  }
}
