import "server-only";
import { NextResponse } from "next/server";
import { getCurrentMember, type CurrentMember } from "@/lib/supabase/server";

/** For route handlers: returns the member or a 401/403 response. */
export async function requireMember(opts: { admin?: boolean } = {}): Promise<CurrentMember | NextResponse> {
  const m = await getCurrentMember();
  if (!m) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (opts.admin && m.role !== "admin") return NextResponse.json({ error: "admins only" }, { status: 403 });
  return m;
}
