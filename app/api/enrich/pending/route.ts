import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/ingest/secure";
import { enrichPending, kickPendingEnrichment } from "@/lib/enrich/pending";
import { log } from "@/lib/log";

export const maxDuration = 300;

/**
 * Work through listings still waiting for a location/commutes, for up to ~4 minutes, then hand
 * the rest to a fresh call of this route. Called by the Apify webhook after a search lands.
 */
export async function POST(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await enrichPending(240_000);
  log.info("enrich.pending", result);
  if (result.remaining > 0 && result.enriched > 0) after(() => kickPendingEnrichment());
  return NextResponse.json({ ok: true, ...result });
}
