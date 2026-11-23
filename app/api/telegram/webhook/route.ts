import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/ingest/secure";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tg } from "@/lib/notify/telegram";
import { parseCallbackData, telegramKeyboard } from "@/lib/notify/format";
import { log } from "@/lib/log";


interface Update {
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
  message?: { text?: string; chat: { id: number }; from?: { id: number; first_name?: string } };
}

/**
 * Telegram → us. Verifies X-Telegram-Bot-Api-Secret-Token, maps the Telegram user to a member
 * (members.telegram_user_id), applies the button action, and updates the message in place.
 * The DB change reaches every open app screen through Supabase Realtime.
 */
export async function POST(req: NextRequest) {
  const e = env();
  if (
    !e.TELEGRAM_WEBHOOK_SECRET ||
    !safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), e.TELEGRAM_WEBHOOK_SECRET)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!e.TELEGRAM_BOT_TOKEN) return NextResponse.json({ ok: true });
  const cfg = { token: e.TELEGRAM_BOT_TOKEN };
  const update = (await req.json().catch(() => ({}))) as Update;
  const db = supabaseAdmin();

  // "/whoami" helps members link their Telegram account in Settings.
  const text = update.message?.text?.trim();
  if (text && /^\/(whoami|start)(@\w+)?$/.test(text) && update.message?.from) {
    await tg(cfg, "sendMessage", {
      chat_id: update.message.chat.id,
      text: `Your Telegram user id is ${update.message.from.id}. Paste it in Belfield Hunt → Settings → Profile to use the buttons.`,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const cq = update.callback_query;
  if (!cq) return NextResponse.json({ ok: true });
  const parsed = parseCallbackData(cq.data);
  const answer = (t: string, alert = false) =>
    tg(cfg, "answerCallbackQuery", { callback_query_id: cq.id, text: t, show_alert: alert }).catch(
      () => {},
    );
  if (!parsed) {
    await answer("Unknown action");
    return NextResponse.json({ ok: true });
  }

  const { data: member } = await db
    .from("members")
    .select("id, display_name")
    .eq("telegram_user_id", cq.from.id)
    .maybeSingle();
  if (!member) {
    await answer(
      `You are not linked yet. Send /whoami and paste your id (${cq.from.id}) in Settings → Profile.`,
      true,
    );
    return NextResponse.json({ ok: true });
  }
  const { data: listing } = await db
    .from("listings")
    .select("id, url")
    .eq("id", parsed.listingId)
    .maybeSingle();
  if (!listing) {
    await answer("Listing not found");
    return NextResponse.json({ ok: true });
  }

  try {
    let claimedName: string | null = null;
    if (parsed.action === "claim" || parsed.action === "noop") {
      const { data: winner } = await db.rpc("claim_listing_as", {
        p_listing_id: listing.id,
        p_member_id: member.id,
      });
      const { data: w } = await db
        .from("members")
        .select("display_name")
        .eq("id", winner as string)
        .maybeSingle();
      claimedName = w?.display_name ?? null;
      await answer(
        winner === member.id ? "✋ Claimed: you are contacting this one." : `Already claimed by ${claimedName}`,
      );
    } else if (parsed.action === "short") {
      await db.from("pipeline").update({ stage: "shortlisted" }).eq("listing_id", listing.id).eq("stage", "new");
      await answer("⭐ Shortlisted");
    } else if (parsed.action === "hide") {
      await db.from("pipeline").update({ hidden: true, hidden_by: member.id }).eq("listing_id", listing.id);
      await answer("🙈 Hidden for everyone");
    }
    if (!claimedName) {
      const { data: p } = await db.from("pipeline").select("claimed_by").eq("listing_id", listing.id).maybeSingle();
      if (p?.claimed_by) {
        const { data: w } = await db.from("members").select("display_name").eq("id", p.claimed_by).maybeSingle();
        claimedName = w?.display_name ?? null;
      }
    }
    if (cq.message) {
      await tg(cfg, "editMessageReplyMarkup", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        reply_markup: telegramKeyboard(listing, claimedName),
      }).catch(() => {}); // "message is not modified" is fine
    }
  } catch (err) {
    log.error("telegram.callback_failed", { error: err as Error });
    await answer("Something went wrong, try in the app", true);
  }
  return NextResponse.json({ ok: true });
}
