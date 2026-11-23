import { sendNotification, setVapidDetails } from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { log } from "@/lib/log";

/** Optional Web Push (VAPID). No-op unless both keys are configured. */
export async function sendPushToAll(
  db: SupabaseClient<Database>,
  payload: { title: string; body: string; url: string; icon?: string | null },
): Promise<number> {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return 0;
  setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  const { data: subs } = await db.from("push_subscriptions").select("*");
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else log.warn("push.failed", { status });
    }
  }
  return sent;
}
