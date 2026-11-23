"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./public-env";

let client: SupabaseClient<Database> | null = null;

/** Singleton browser client (anon key + user session cookie; RLS applies). */
export function supabaseBrowser(): SupabaseClient<Database> {
  if (!client) client = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
