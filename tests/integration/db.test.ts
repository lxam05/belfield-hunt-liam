/**
 * Integration tests against a local Supabase (`pnpm supabase start`).
 * Skipped automatically when the local stack isn't reachable.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { GROUP_ID } from "@/lib/config/defaults";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function reachable() {
  if (!ANON || !SERVICE) return false;
  try {
    const r = await fetch(`${URL}/auth/v1/health`, { headers: { apikey: ANON } });
    return r.ok;
  } catch {
    return false;
  }
}

const up = await reachable();
const LISTING_ID = 990000001;

describe.skipIf(!up)("database (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  const users: {
    email: string;
    client: SupabaseClient<Database>;
    memberId: string;
    userId: string;
  }[] = [];

  beforeAll(async () => {
    admin = createClient<Database>(URL, SERVICE, { auth: { persistSession: false } });
    for (const name of ["alice", "bob"]) {
      const email = `${name}.itest@example.com`;
      const password = "itest-password-123";
      // Clean up previous runs.
      await admin.from("members").delete().eq("email", email);
      const { data: list } = await admin.auth.admin.listUsers();
      const old = list?.users.find((u) => u.email === email);
      if (old) await admin.auth.admin.deleteUser(old.id);

      const { data: member } = await admin
        .from("members")
        .insert({ group_id: GROUP_ID, email, display_name: name })
        .select("id")
        .single();
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      const client = createClient<Database>(URL, ANON, { auth: { persistSession: false } });
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
      if (signInErr) throw signInErr;
      users.push({ email, client, memberId: member!.id, userId: created.user.id });
    }
    await admin.from("listings").delete().eq("id", LISTING_ID);
    await admin
      .from("listings")
      .insert({ id: LISTING_ID, url: "https://www.daft.ie/for-rent/x/1", title: "Test, Dublin 4" });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("listings").delete().eq("id", LISTING_ID);
    for (const u of users) {
      await admin.from("members").delete().eq("id", u.memberId);
      await admin.auth.admin.deleteUser(u.userId);
    }
  });

  it("links the auth user to the invited member row by email", async () => {
    const { data } = await admin
      .from("members")
      .select("user_id")
      .eq("id", users[0].memberId)
      .single();
    expect(data!.user_id).toBe(users[0].userId);
  });

  it("anonymous clients can read nothing", async () => {
    const anon = createClient<Database>(URL, ANON, { auth: { persistSession: false } });
    const { data } = await anon.from("listings").select("id").eq("id", LISTING_ID);
    expect(data ?? []).toHaveLength(0);
    const { data: s } = await anon.from("settings").select("*");
    expect(s ?? []).toHaveLength(0);
  });

  it("members can read listings and the auto-created pipeline row", async () => {
    const { data } = await users[0].client
      .from("pipeline")
      .select("stage")
      .eq("listing_id", LISTING_ID)
      .single();
    expect(data!.stage).toBe("new");
  });

  it("members cannot write listings (service role only)", async () => {
    await users[0].client.from("listings").update({ title: "hacked" }).eq("id", LISTING_ID);
    const { data } = await admin.from("listings").select("title").eq("id", LISTING_ID).single();
    expect(data!.title).toBe("Test, Dublin 4");
  });

  it("two members claiming at the same time: exactly one wins", async () => {
    const [a, b] = await Promise.all(
      users.map((u) => u.client.rpc("claim_listing", { p_listing_id: LISTING_ID })),
    );
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data).toBe(b.data); // both see the same winner
    expect([users[0].memberId, users[1].memberId]).toContain(a.data);
    const { data } = await admin
      .from("pipeline")
      .select("claimed_by, stage")
      .eq("listing_id", LISTING_ID)
      .single();
    expect(data!.claimed_by).toBe(a.data);
    expect(data!.stage).toBe("contacting");
  });

  it("the loser cannot steal the claim with a direct update", async () => {
    const { data: p } = await admin
      .from("pipeline")
      .select("claimed_by")
      .eq("listing_id", LISTING_ID)
      .single();
    const loser = users.find((u) => u.memberId !== p!.claimed_by)!;
    const { error } = await loser.client
      .from("pipeline")
      .update({ claimed_by: loser.memberId, claimed_at: new Date().toISOString() })
      .eq("listing_id", LISTING_ID);
    expect(error?.message).toMatch(/already_claimed/);
    const { error: unclaimErr } = await loser.client.rpc("unclaim_listing", {
      p_listing_id: LISTING_ID,
    });
    expect(unclaimErr).toBeNull();
    const { data: after } = await admin
      .from("pipeline")
      .select("claimed_by")
      .eq("listing_id", LISTING_ID)
      .single();
    expect(after!.claimed_by).toBe(p!.claimed_by);
  });

  it("votes are per member and cannot be forged for others", async () => {
    const ok = await users[0].client
      .from("votes")
      .upsert({ listing_id: LISTING_ID, member_id: users[0].memberId, value: 1, stars: 4 });
    expect(ok.error).toBeNull();
    const forged = await users[0].client
      .from("votes")
      .insert({ listing_id: LISTING_ID, member_id: users[1].memberId, value: -1 });
    expect(forged.error).not.toBeNull();
  });

  it("service-only RPCs are not callable by members", async () => {
    const { error } = await users[0].client.rpc("increment_api_usage", {
      p_provider: "google",
      p_sku: "x",
      p_month: "2026-11",
      p_n: 1,
    });
    expect(error).not.toBeNull();
  });
});
