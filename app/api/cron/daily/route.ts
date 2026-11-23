import { NextResponse, connection, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/ingest/secure";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendText } from "@/lib/notify/telegram";
import { escapeHtml, rentLabel, bedsLabel } from "@/lib/notify/format";
import { assessRental, campusPoint } from "@/lib/rental-search";
import { GROUP_ID, toSearchSettings } from "@/lib/config/defaults";
import { dublinDateKey } from "@/lib/time";
import { recordEvent } from "@/lib/ingest/handle";
import { log } from "@/lib/log";

export const maxDuration = 60;

/**
 * The single daily Vercel cron (Hobby allows at most one run per day): the 09:00 digest of
 * unclaimed matching listings, plus housekeeping (prune old events, stale-scrape alert).
 * vercel.json uses 08:00 UTC: 09:00 Irish Summer Time, 08:00 in winter (UTC crons can't follow
 * DST). Repeat hits on the same Dublin date don't resend the digest.
 */
export async function GET(req: NextRequest) {
  await connection(); // request-time only: never prerender at build

  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const e = env();
  const db = supabaseAdmin();
  const today = dublinDateKey();
  const { data: settings } = await db.from("settings").select("*").eq("group_id", GROUP_ID).single();
  const s = toSearchSettings(settings);
  const tgCfg =
    e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID ? { token: e.TELEGRAM_BOT_TOKEN, chatId: e.TELEGRAM_CHAT_ID } : null;

  // Unclaimed, visible, active, budget-fitting listings first seen in the last 3 days.
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const { data: rows } = await db
    .from("listings")
    .select(
      "id, title, url, area, lat, lng, geocode_precision, monthly_rent, price_is_from, price_on_application, beds, beds_min, beds_max, score, first_seen_at, pipeline!inner(claimed_by, hidden, stage)",
    )
    .eq("status", "active")
    .gte("first_seen_at", since)
    .is("pipeline.claimed_by", null)
    .eq("pipeline.hidden", false)
    .in("pipeline.stage", ["new", "shortlisted"])
    .order("score", { ascending: false })
    .limit(50);
  const { data: destinations } = await db.from("destinations").select("id, lat, lng").eq("group_id", GROUP_ID);
  const campus = campusPoint(destinations ?? []);
  const fitting = (rows ?? []).filter((l) => assessRental(l, campus, s.maxPerPerson).matches);

  let sent = false;
  if (fitting.length && tgCfg) {
    // Once per Dublin date: a sentinel notifications row keyed on the top listing.
    const { data: slot } = await db
      .from("notifications")
      .upsert(
        { listing_id: fitting[0].id, channel: `digest:${today}` },
        { onConflict: "listing_id,channel", ignoreDuplicates: true },
      )
      .select();
    if (slot && slot.length) {
      const lines = fitting
        .slice(0, 15)
        .map(
          (l, i) =>
            `${i + 1}. <a href="${e.APP_URL}/listing/${l.id}">${escapeHtml(l.title)}</a>\n    ${escapeHtml(rentLabel(l))} · ${bedsLabel(l)} · score ${l.score ?? "—"}`,
        );
      await sendText(
        tgCfg,
        `☀️ <b>Daily digest</b>: ${fitting.length} unclaimed listing${fitting.length === 1 ? "" : "s"} within budget\n\n${lines.join("\n")}\n\nClaim one before someone else does 👀`,
      ).catch((err) => log.warn("digest.send_failed", { error: err as Error }));
      sent = true;
    }
  }

  // Housekeeping.
  await db.from("events").delete().lt("at", new Date(Date.now() - 30 * 864e5).toISOString());
  const { data: lastRun } = await db
    .from("scrape_runs")
    .select("received_at")
    .eq("status", "succeeded")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const staleHours = lastRun ? (Date.now() - new Date(lastRun.received_at).getTime()) / 36e5 : null;
  if (staleHours == null || staleHours > 26) {
    const msg = `No successful scrape in ${staleHours == null ? "ever" : `${Math.round(staleHours)} h`}`;
    await recordEvent("health.stale", "warn", msg);
    if (tgCfg) {
      await sendText(tgCfg, `⚠️ ${msg}. Check Settings → Health (Apify credits? webhook?).`).catch(() => {});
    }
  }
  await recordEvent("cron.daily", "info", `digest ${sent ? "sent" : "skipped"} (${fitting.length} unclaimed)`);
  return NextResponse.json({ ok: true, unclaimed: fitting.length, digestSent: sent });
}
