import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireMember } from "@/lib/auth/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { provisionApify } from "@/lib/apify/provision";
import { recordEvent } from "@/lib/ingest/handle";

export const maxDuration = 60;

/** Settings → "Apply to Apify": same code path as `pnpm setup:apify`. */
export async function POST() {
  const me = await requireMember();
  if (me instanceof NextResponse) return me;
  const e = env();
  if (!e.APIFY_TOKEN || !e.APIFY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "APIFY_TOKEN and APIFY_WEBHOOK_SECRET must be set" }, { status: 503 });
  }
  const lines: string[] = [];
  try {
    const result = await provisionApify({
      token: e.APIFY_TOKEN,
      appUrl: e.APP_URL,
      webhookSecret: e.APIFY_WEBHOOK_SECRET,
      db: supabaseAdmin(),
      log: (m) => lines.push(m),
    });
    await recordEvent("apify.provisioned", "info", `${me.displayName} applied settings to Apify`, { lines });
    return NextResponse.json({ ok: true, result, log: lines });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, log: lines }, { status: 500 });
  }
}
