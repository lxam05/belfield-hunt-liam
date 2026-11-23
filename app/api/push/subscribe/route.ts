import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth/api";
import { supabaseServer } from "@/lib/supabase/server";


const Sub = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Store or remove the current member's Web Push subscription (RLS: own rows only). */
export async function POST(req: NextRequest) {
  const me = await requireMember();
  if (me instanceof NextResponse) return me;
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad subscription" }, { status: 400 });
  const sb = await supabaseServer();
  const { error } = await sb.from("push_subscriptions").upsert({
    endpoint: parsed.data.endpoint,
    member_id: me.memberId,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const me = await requireMember();
  if (me instanceof NextResponse) return me;
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  const sb = await supabaseServer();
  await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
