"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/ingest/secure";
import { GROUP_ID } from "@/lib/config/defaults";

export interface LoginState {
  message: string;
}

const COLOURS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444"];

/** Synthetic, never-emailed address that ties a display name to its Supabase auth user. */
function memberEmail(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member";
  return `${slug}@members.belfield-hunt.local`;
}

/**
 * Shared-password entry. One group password (SITE_PASSWORD) plus your name: the name picks an
 * existing member (case-insensitive) or creates one. Supabase Auth still runs underneath, so RLS,
 * Realtime and per-member claims/votes keep working, but no email is ever sent.
 */
export async function enter(_prev: LoginState, form: FormData): Promise<LoginState> {
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!name || name.length > 40) return { message: "Enter your name (up to 40 characters)." };
  if (!safeEqual(password, process.env.SITE_PASSWORD)) return { message: "Wrong password." };

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("members")
    .select("id, email, user_id")
    .ilike("display_name", name.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(1)
    .maybeSingle();

  let email = existing?.email;
  if (!existing) {
    const { count } = await db.from("members").select("id", { count: "exact", head: true });
    email = memberEmail(name);
    const { error } = await db.from("members").insert({
      group_id: GROUP_ID,
      email,
      display_name: name,
      role: "admin", // everyone shares the password, so everyone can change settings
      colour: COLOURS[(count ?? 0) % COLOURS.length],
    });
    if (error) return { message: `Couldn't add you: ${error.message}` };
  }

  if (!existing?.user_id) {
    // The on_auth_user_created trigger links the new auth user to the member row by email.
    const { error } = await db.auth.admin.createUser({ email: email!, email_confirm: true });
    if (error && !/already/i.test(error.message)) return { message: `Couldn't sign in: ${error.message}` };
  }

  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email: email! });
  if (linkErr) return { message: `Couldn't sign in: ${linkErr.message}` };
  const sb = await supabaseServer();
  const { error: otpErr } = await sb.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (otpErr) return { message: `Couldn't sign in: ${otpErr.message}` };

  redirect(safeNext);
}
