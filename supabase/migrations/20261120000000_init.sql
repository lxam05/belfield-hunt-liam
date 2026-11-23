-- Belfield Hunt — initial schema.
-- RLS on every table: only authenticated members of the group can read/write.
-- Server jobs (webhooks, cron, scripts) use the service-role key, which bypasses RLS.

create extension if not exists pgcrypto;

-- ─── Enums ──────────────────────────────────────────────────────────────────
create type public.listing_status as enum ('active', 'possibly_gone', 'gone');
create type public.pipeline_stage as enum (
  'new', 'shortlisted', 'contacting', 'contacted', 'viewing_booked',
  'viewed', 'applied', 'offer', 'rejected', 'gone'
);
create type public.commute_mode as enum ('transit', 'transit_return', 'bicycle', 'walk');
create type public.contact_channel as enum ('email', 'phone', 'daft-form', 'whatsapp');
create type public.member_role as enum ('admin', 'member');

-- ─── Groups & members ───────────────────────────────────────────────────────
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid unique references auth.users (id) on delete set null,
  email text not null unique,
  display_name text not null,
  colour text not null default '#6366f1',
  role public.member_role not null default 'member',
  telegram_user_id bigint unique,
  interns_at_sandyford boolean not null default false,
  -- Mode this member actually uses for the commute score: 'best' = fastest available.
  commute_mode text not null default 'best' check (commute_mode in ('best', 'transit', 'bicycle', 'walk')),
  created_at timestamptz not null default now()
);
create index members_group_idx on public.members (group_id);

-- Is the current auth user a member of any group? (single group for now)
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.role = 'admin');
$$;

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id from public.members m where m.user_id = auth.uid() limit 1;
$$;

-- Link an invited member row to the auth user when they first sign in.
create or replace function public.link_member_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.members set user_id = new.id
  where lower(email) = lower(new.email) and user_id is null;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_member_on_signup();

-- ─── Settings ───────────────────────────────────────────────────────────────
create table public.settings (
  group_id uuid primary key references public.groups (id) on delete cascade,
  max_per_person integer not null default 1350 check (max_per_person > 0),
  beds_min integer not null default 2 check (beds_min between 1 and 10),
  beds_max integer not null default 5 check (beds_max between 1 and 10),
  group_size_min integer not null default 2 check (group_size_min between 1 and 10),
  group_size_max integer not null default 5 check (group_size_max between 1 and 10),
  daft_location_slugs text[] not null default array[
    'dublin-4-dublin', 'dublin-6-dublin', 'dublin-14-dublin', 'dublin-18-dublin',
    'stillorgan-dublin', 'mount-merrion-dublin', 'booterstown-dublin', 'blackrock-dublin',
    'dublin-16-dublin'
  ],
  fast_lane_cron text not null default '*/30 7-22 * * *',
  sweep_cron text not null default '30 3 * * *',
  fast_lane_results_wanted integer not null default 10,
  sweep_results_wanted integer not null default 300,
  apify_fast_task_id text,
  apify_sweep_task_id text,
  apify_fast_schedule_id text,
  apify_sweep_schedule_id text,
  apify_webhook_ids text[] not null default '{}',
  apify_provisioned_at timestamptz,
  score_weights jsonb not null default
    '{"affordability":30,"commute":35,"freshness":15,"beds":5,"votes":15}'::jsonb,
  notify_score_threshold integer not null default 40,
  group_profile jsonb not null default '{}'::jsonb,
  templates jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (beds_min <= beds_max),
  check (group_size_min <= group_size_max)
);

-- ─── Destinations ───────────────────────────────────────────────────────────
create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null,
  short_name text not null,
  emoji text not null default '📍',
  address text not null,
  lat double precision not null,
  lng double precision not null,
  weight numeric not null default 1,
  -- Members commuting here. Empty = derived (interns → Sandyford, others → UCD).
  who_commutes uuid[] not null default '{}',
  is_intern_site boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ─── Listings ───────────────────────────────────────────────────────────────
create table public.listings (
  id bigint primary key, -- Daft listing id
  daft_shortcode text,
  url text not null,
  raw_url text,
  title text not null,
  area text,
  suburb text,
  eircode text,
  lat double precision,
  lng double precision,
  geocode_precision text, -- 'eircode' | 'rooftop' | 'street' | 'area' | 'fallback' | 'failed'
  monthly_rent integer,
  price_text text,
  price_is_from boolean not null default false,
  price_on_application boolean not null default false,
  beds integer,
  beds_min integer,
  beds_max integer,
  baths integer,
  property_type text,
  is_development boolean not null default false,
  seller_name text,
  seller_phone text,
  image_cover text,
  images text[] not null default '{}',
  image_count integer not null default 0,
  has_video boolean not null default false,
  has_virtual_tour boolean not null default false,
  featured_level text,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_swept_at timestamptz,
  missed_sweeps integer not null default 0,
  status public.listing_status not null default 'active',
  score integer, -- base score at ingestion (for notify threshold & default sort)
  enriched_at timestamptz,
  raw jsonb not null default '{}'::jsonb
);
create index listings_first_seen_idx on public.listings (first_seen_at desc);
create index listings_published_idx on public.listings (published_at desc);
create index listings_status_idx on public.listings (status);

-- ─── Commutes ───────────────────────────────────────────────────────────────
create table public.commutes (
  id uuid primary key default gen_random_uuid(),
  listing_id bigint not null references public.listings (id) on delete cascade,
  destination_id uuid not null references public.destinations (id) on delete cascade,
  mode public.commute_mode not null,
  minutes integer,
  walk_minutes integer,
  transfers integer,
  distance_m integer,
  lines text[] not null default '{}',
  source text not null default 'google' check (source in ('google', 'estimate')),
  computed_at timestamptz not null default now(),
  unique (listing_id, destination_id, mode)
);

-- ─── Pipeline (one row per listing; claim lives here) ───────────────────────
create table public.pipeline (
  listing_id bigint primary key references public.listings (id) on delete cascade,
  stage public.pipeline_stage not null default 'new',
  claimed_by uuid references public.members (id) on delete set null,
  claimed_at timestamptz,
  next_action_at timestamptz,
  next_action text,
  viewing_at timestamptz,
  hidden boolean not null default false,
  hidden_by uuid references public.members (id) on delete set null,
  pinned boolean not null default false,
  manual_rank integer,
  updated_at timestamptz not null default now(),
  check ((claimed_by is null) = (claimed_at is null))
);
create index pipeline_stage_idx on public.pipeline (stage);

-- DB-level claim guard: a claim can only be taken when free, and only released or
-- handed over by the current claimer (or an admin). Two members can never both claim.
create or replace function public.pipeline_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_member_id();
begin
  new.updated_at := now();
  -- Service role (webhooks/telegram) has no auth.uid(); it uses claim_listing_as().
  if auth.uid() is null then
    return new;
  end if;
  if old.claimed_by is distinct from new.claimed_by then
    if old.claimed_by is not null and old.claimed_by <> me and not public.is_admin() then
      raise exception 'already_claimed' using errcode = 'P0001',
        detail = 'This listing is claimed by another member.';
    end if;
    if new.claimed_by is not null and new.claimed_by <> me and not public.is_admin() then
      raise exception 'cannot_claim_for_others' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger pipeline_guard_trg
  before update on public.pipeline
  for each row execute function public.pipeline_guard();

-- Atomic claim for the current user. Returns the resulting claimer (may be someone else).
create or replace function public.claim_listing(p_listing_id bigint)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  me uuid := public.current_member_id();
  winner uuid;
begin
  if me is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  insert into public.pipeline (listing_id) values (p_listing_id) on conflict do nothing;
  update public.pipeline
     set claimed_by = me, claimed_at = now(),
         stage = case when stage in ('new', 'shortlisted') then 'contacting'::public.pipeline_stage else stage end
   where listing_id = p_listing_id and claimed_by is null;
  select claimed_by into winner from public.pipeline where listing_id = p_listing_id;
  return winner;
end;
$$;

-- Service-role variant used by the Telegram callback (no auth.uid()).
create or replace function public.claim_listing_as(p_listing_id bigint, p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  winner uuid;
begin
  insert into public.pipeline (listing_id) values (p_listing_id) on conflict do nothing;
  update public.pipeline
     set claimed_by = p_member_id, claimed_at = now(),
         stage = case when stage in ('new', 'shortlisted') then 'contacting'::public.pipeline_stage else stage end
   where listing_id = p_listing_id and claimed_by is null;
  select claimed_by into winner from public.pipeline where listing_id = p_listing_id;
  return winner;
end;
$$;
revoke execute on function public.claim_listing_as(bigint, uuid) from public, anon, authenticated;

create or replace function public.unclaim_listing(p_listing_id bigint)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.pipeline set claimed_by = null, claimed_at = null
   where listing_id = p_listing_id
     and (claimed_by = public.current_member_id() or public.is_admin());
$$;

-- ─── Votes, notes, contact log ──────────────────────────────────────────────
create table public.votes (
  listing_id bigint not null references public.listings (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  value smallint not null default 0 check (value in (-1, 0, 1)),
  stars smallint check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (listing_id, member_id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  listing_id bigint not null references public.listings (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index notes_listing_idx on public.notes (listing_id, created_at);

create table public.contact_log (
  id uuid primary key default gen_random_uuid(),
  listing_id bigint not null references public.listings (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  channel public.contact_channel not null,
  at timestamptz not null default now(),
  outcome text
);
create index contact_log_listing_idx on public.contact_log (listing_id, at desc);

-- ─── Ops: scrape runs, API usage, caches, notifications ────────────────────
create table public.scrape_runs (
  apify_run_id text primary key,
  kind text not null default 'fast_lane' check (kind in ('fast_lane', 'nightly_sweep', 'manual', 'replay', 'unknown')),
  task_id text,
  dataset_id text,
  event_type text,
  status text not null default 'received' check (status in ('received', 'processing', 'succeeded', 'failed', 'apify_failed')),
  items integer not null default 0,
  new_items integer not null default 0,
  updated_items integer not null default 0,
  notified integer not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  error text,
  received_at timestamptz not null default now(),
  finished_at timestamptz
);
create index scrape_runs_received_idx on public.scrape_runs (received_at desc);

create table public.api_usage (
  provider text not null,  -- 'apify' | 'google'
  sku text not null,       -- e.g. 'results', 'runs', 'geocoding', 'routes_transit'
  month text not null,     -- 'YYYY-MM' (Europe/Dublin)
  count integer not null default 0,
  primary key (provider, sku, month)
);

create or replace function public.increment_api_usage(p_provider text, p_sku text, p_month text, p_n integer default 1)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.api_usage (provider, sku, month, count)
  values (p_provider, p_sku, p_month, p_n)
  on conflict (provider, sku, month) do update set count = public.api_usage.count + excluded.count
  returning count;
$$;
revoke execute on function public.increment_api_usage(text, text, text, integer) from public, anon, authenticated;

-- Geocoding cache keyed by normalized query (dedupes re-listed addresses).
create table public.geocode_cache (
  query text primary key,
  lat double precision,
  lng double precision,
  precision text,
  formatted_address text,
  created_at timestamptz not null default now()
);

-- One row per (listing, channel) — guarantees no repeat notifications on replays.
create table public.notifications (
  listing_id bigint not null references public.listings (id) on delete cascade,
  channel text not null, -- 'telegram' | 'push' | 'digest:YYYY-MM-DD'
  message_id text,
  sent_at timestamptz not null default now(),
  primary key (listing_id, channel)
);

create table public.push_subscriptions (
  endpoint text primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Generic event log for the health panel (webhook hits, failures, alerts).
create table public.events (
  id bigserial primary key,
  kind text not null,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  message text not null,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index events_at_idx on public.events (at desc);

-- Every listing gets a pipeline row on insert.
create or replace function public.listing_pipeline_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pipeline (listing_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger listings_pipeline_trg
  after insert on public.listings
  for each row execute function public.listing_pipeline_row();

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.settings enable row level security;
alter table public.destinations enable row level security;
alter table public.listings enable row level security;
alter table public.commutes enable row level security;
alter table public.pipeline enable row level security;
alter table public.votes enable row level security;
alter table public.notes enable row level security;
alter table public.contact_log enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.api_usage enable row level security;
alter table public.geocode_cache enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.events enable row level security;

-- Read access for members on everything group-visible.
create policy "members read groups" on public.groups for select to authenticated using (public.is_member());
create policy "members read members" on public.members for select to authenticated using (public.is_member());
create policy "members read settings" on public.settings for select to authenticated using (public.is_member());
create policy "members read destinations" on public.destinations for select to authenticated using (public.is_member());
create policy "members read listings" on public.listings for select to authenticated using (public.is_member());
create policy "members read commutes" on public.commutes for select to authenticated using (public.is_member());
create policy "members read pipeline" on public.pipeline for select to authenticated using (public.is_member());
create policy "members read votes" on public.votes for select to authenticated using (public.is_member());
create policy "members read notes" on public.notes for select to authenticated using (public.is_member());
create policy "members read contact_log" on public.contact_log for select to authenticated using (public.is_member());
create policy "members read scrape_runs" on public.scrape_runs for select to authenticated using (public.is_member());
create policy "members read api_usage" on public.api_usage for select to authenticated using (public.is_member());
create policy "members read notifications" on public.notifications for select to authenticated using (public.is_member());
create policy "members read events" on public.events for select to authenticated using (public.is_member());

-- Writes.
create policy "members update own profile" on public.members for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy "admins manage members" on public.members for insert to authenticated with check (public.is_admin());
create policy "admins delete members" on public.members for delete to authenticated using (public.is_admin());

create policy "members update settings" on public.settings for update to authenticated
  using (public.is_member()) with check (public.is_member());

create policy "members write destinations" on public.destinations for all to authenticated
  using (public.is_member()) with check (public.is_member());

create policy "members update pipeline" on public.pipeline for update to authenticated
  using (public.is_member()) with check (public.is_member());
create policy "members insert pipeline" on public.pipeline for insert to authenticated
  with check (public.is_member());

create policy "members write own votes" on public.votes for all to authenticated
  using (member_id = public.current_member_id())
  with check (member_id = public.current_member_id());

create policy "members add own notes" on public.notes for insert to authenticated
  with check (member_id = public.current_member_id());
create policy "members delete own notes" on public.notes for delete to authenticated
  using (member_id = public.current_member_id());

create policy "members log own contacts" on public.contact_log for insert to authenticated
  with check (member_id = public.current_member_id());

create policy "members manage own push subs" on public.push_subscriptions for all to authenticated
  using (member_id = public.current_member_id())
  with check (member_id = public.current_member_id());

-- Listings, commutes, scrape_runs, api_usage, geocode_cache, notifications, events:
-- written by the service role only (no authenticated write policies).

-- ─── Realtime ───────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.listings, public.pipeline, public.votes,
  public.notes, public.commutes, public.contact_log;
