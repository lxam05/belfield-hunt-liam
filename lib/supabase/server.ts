import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./public-env";

/** Per-request server client acting as the signed-in user (RLS applies). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

export interface CurrentMember {
  userId: string;
  memberId: string;
  role: "admin" | "member";
  displayName: string;
  email: string;
}

/** Resolve the signed-in user's member row, or null if not signed in / not a member. */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data } = await sb
    .from("members")
    .select("id, role, display_name, email")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    userId: auth.user.id,
    memberId: data.id,
    role: data.role,
    displayName: data.display_name,
    email: data.email,
  };
}
