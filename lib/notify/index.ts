import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fitsBudget } from "@/lib/budget";
import { log } from "@/lib/log";
import { bedsLabel, commuteChips, rentLabel, telegramCaption, telegramKeyboard, type NotifyCommute, type NotifyDestination, type NotifyListing } from "./format";
import { sendListingMessage } from "./telegram";
import { sendPushToAll } from "./push";

type Db = SupabaseClient<Database>;

export interface NotifyContext {
  db: Db;
  appUrl: string;
  maxPerPerson: number;
  bedsMin: number;
  bedsMax: number;
  threshold: number;
  destinations: NotifyDestination[];
  telegram?: { token: string; chatId: string };
  fetchImpl?: typeof fetch;
}

export function shouldNotify(l: NotifyListing, ctx: Pick<NotifyContext, "maxPerPerson" | "bedsMin" | "bedsMax" | "threshold">): boolean {
  if (!fitsBudget(l, ctx.maxPerPerson)) return false;
  const lo = l.beds ?? l.beds_max;
  const hi = l.beds ?? l.beds_min;
  if (lo == null || hi == null || lo < ctx.bedsMin || hi > ctx.bedsMax) return false;
  return (l.score ?? 0) >= ctx.threshold;
}

/**
 * Notify once per (listing, channel). The `notifications` primary key makes this idempotent:
 * a replayed dataset or a retried webhook can never send the same listing twice.
 */
export async function notifyListing(l: NotifyListing, commutes: NotifyCommute[], ctx: NotifyContext): Promise<boolean> {
  if (!shouldNotify(l, ctx)) return false;
  const { data: pipeline, error } = await ctx.db.from("pipeline").select("hidden").eq("listing_id", l.id).single();
  if (error || pipeline.hidden) return false;
  let any = false;

  if (ctx.telegram) {
    const { data: claimed } = await ctx.db
      .from("notifications")
      .upsert({ listing_id: l.id, channel: "telegram" }, { onConflict: "listing_id,channel", ignoreDuplicates: true })
      .select();
    if (claimed && claimed.length > 0) {
      try {
        const caption = telegramCaption(l, ctx.destinations, commutes, ctx.maxPerPerson, ctx.appUrl);
        const messageId = await sendListingMessage({ ...ctx.telegram, fetchImpl: ctx.fetchImpl }, caption, l.image_cover, telegramKeyboard(l));
        await ctx.db.from("notifications").update({ message_id: String(messageId) }).eq("listing_id", l.id).eq("channel", "telegram");
        any = true;
      } catch (e) {
        log.error("telegram.send_failed", { listingId: l.id, error: e as Error });
        // Release the slot so the next run (or the digest) can retry.
        await ctx.db.from("notifications").delete().eq("listing_id", l.id).eq("channel", "telegram");
      }
    }
  }

  const { data: pushSlot } = await ctx.db
    .from("notifications")
    .upsert({ listing_id: l.id, channel: "push" }, { onConflict: "listing_id,channel", ignoreDuplicates: true })
    .select();
  if (pushSlot && pushSlot.length > 0) {
    const sent = await sendPushToAll(ctx.db, {
      title: `${rentLabel(l)} · ${bedsLabel(l)} · ${l.area ?? ""}`.trim(),
      body: [l.title, ...commuteChips(ctx.destinations, commutes)].join("\n"),
      url: `/listing/${l.id}`,
      icon: l.image_cover,
    });
    any ||= sent > 0;
  }
  return any;
}
