import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/api";
import { enrichListings } from "@/lib/enrich";
import { enrichDeps } from "@/lib/ingest/handle";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 120;

const Body = z.object({
  listingId: z.number().int().positive(),
  /** Drop cached commutes first, e.g. after moving a destination pin. */
  recompute: z.boolean().default(false),
});

/** Re-run enrichment for one listing (never re-notifies: notification slots are permanent). */
export async function POST(req: NextRequest) {
  const me = await requireMember();
  if (me instanceof NextResponse) return me;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (parsed.data.recompute) {
    await supabaseAdmin().from("commutes").delete().eq("listing_id", parsed.data.listingId);
  }
  const summary = await enrichListings([parsed.data.listingId], { ...enrichDeps(), notify: false });
  return NextResponse.json({ ok: true, summary });
}
