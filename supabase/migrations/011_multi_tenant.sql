-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-tenant conversion.
--
-- Every business row gets a tenant_id, and RLS scopes reads/writes to the
-- caller's tenant. Customer A must be unable to read Customer B's rows even
-- with a valid session, so policies key off the JWT, never off a client value.
--
-- Order matters: create tenants, backfill an owner tenant for existing rows,
-- THEN set NOT NULL, so the 357 existing leads are never orphaned.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'solo' check (plan in ('solo', 'company')),
  -- Lifecycle: a tenant exists before payment clears, so access is gated on status.
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'cancelled')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  setup_fee_paid boolean not null default false,
  -- The tenant that owns everything created before multi-tenancy existed.
  -- Explicit rather than "the oldest row": the operator's own login has no
  -- Supabase user and so no tenant_members row, and lib/tenant.ts resolves it
  -- through this flag. Row age is not a safe identifier once real customers
  -- exist and rows can be backdated, restored, or reordered.
  is_founding boolean not null default false,
  -- Seats / caps are per-plan and enforced in app code against these numbers.
  seat_limit integer not null default 1,
  niche_limit integer not null default 1,
  inbox_limit integer not null default 1,
  monthly_lead_cap integer not null default 500,
  monthly_send_cap integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Links a Supabase Auth user to exactly one tenant, with a role.
create table if not exists tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner', 'admin', 'operator')),
  created_at timestamptz not null default now(),
  unique (user_id)
);
create index if not exists idx_tenant_members_tenant on tenant_members(tenant_id);

-- Per-tenant secrets: their AI keys, inbox tokens, calendar connection.
-- Never global, never our keys. Values are written server-side only.
create table if not exists tenant_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null,            -- e.g. 'ai_provider', 'inbox', 'calendar'
  name text not null,            -- e.g. 'GEMINI_API_KEY', 'graph_refresh_token'
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, name)
);

-- The niche questionnaire answers and the config generated from them.
-- This is what the one time setup fee actually produces.
create table if not exists tenant_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  label text not null default 'default',
  icp text,
  niche text,
  territories text[],
  differentiators text,
  offer text,
  questionnaire jsonb not null default '{}'::jsonb,
  generated_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, label)
);

-- Per-tenant metering, extending the existing DB-enforced quota pattern so one
-- heavy customer cannot blow up shared cost.
create table if not exists tenant_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  period_key text not null,      -- e.g. '2026-08' or 'week_2026-08-17'
  metric text not null,          -- 'leads_discovered' | 'emails_sent' | 'places_requests'
  used integer not null default 0,
  cap integer not null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, period_key, metric)
);
create index if not exists idx_tenant_usage_lookup on tenant_usage(tenant_id, period_key, metric);

-- ── tenant_id on every business table ───────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'leads','lead_ai_summaries','lead_socials','lead_research_facts',
    'status_audit_log','follow_up_tasks','outreach_log','appointments',
    'call_logs','lead_notes','cron_failures','lead_discovery_config'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists tenant_id uuid references tenants(id) on delete cascade', t);
      execute format('create index if not exists idx_%s_tenant on public.%I(tenant_id)', t, t);
    end if;
  end loop;
end $$;

-- ── Backfill: existing data belongs to the founding tenant ──────────────────
insert into tenants (name, plan, status, setup_fee_paid, seat_limit, niche_limit, inbox_limit, is_founding)
select 'Full Stack Services', 'company', 'active', true, 5, 5, 5, true
where not exists (select 1 from tenants);

-- Exactly one founding tenant, enforced by the database rather than by
-- convention. A second one would make founderTenant() ambiguous and could hand
-- the operator's session another customer's data.
create unique index if not exists idx_tenants_single_founding
  on tenants (is_founding) where is_founding;

do $$
declare owner_tenant uuid; t text;
begin
  select id into owner_tenant from tenants where is_founding order by created_at asc limit 1;
  -- Pre-existing database with tenants but none flagged: adopt the oldest, so
  -- re-running this migration after a partial apply cannot orphan the backfill.
  if owner_tenant is null then
    update tenants set is_founding = true
    where id = (select id from tenants order by created_at asc limit 1);
    select id into owner_tenant from tenants where is_founding limit 1;
  end if;
  if owner_tenant is null then return; end if;

  foreach t in array array[
    'leads','lead_ai_summaries','lead_socials','lead_research_facts',
    'status_audit_log','follow_up_tasks','outreach_log','appointments',
    'call_logs','lead_notes','cron_failures','lead_discovery_config'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('update public.%I set tenant_id = %L where tenant_id is null', t, owner_tenant);
      -- Only enforce NOT NULL once the backfill has actually filled the table.
      execute format('alter table public.%I alter column tenant_id set not null', t);
    end if;
  end loop;
end $$;

-- ── RLS: scope every row by the caller's tenant ─────────────────────────────
-- current_tenant_id() reads the caller's membership from their JWT user id.
-- It is STABLE and SECURITY DEFINER so policies can call it without granting
-- the caller direct read access to tenant_members.
create or replace function current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from tenant_members where user_id = auth.uid() limit 1;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'leads','lead_ai_summaries','lead_socials','lead_research_facts',
    'status_audit_log','follow_up_tasks','outreach_log','appointments',
    'call_logs','lead_notes','cron_failures','lead_discovery_config',
    'tenant_secrets','tenant_configs','tenant_usage'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force row level security', t);
      execute format('drop policy if exists tenant_isolation on public.%I', t);
      execute format(
        'create policy tenant_isolation on public.%I
           for all
           using (tenant_id = current_tenant_id())
           with check (tenant_id = current_tenant_id())', t);
    end if;
  end loop;
end $$;

-- A member sees only their own tenant row.
alter table tenants enable row level security;
alter table tenants force row level security;
drop policy if exists tenant_self on tenants;
create policy tenant_self on tenants
  for select using (id = current_tenant_id());

alter table tenant_members enable row level security;
alter table tenant_members force row level security;
drop policy if exists member_self on tenant_members;
create policy member_self on tenant_members
  for select using (tenant_id = current_tenant_id());

-- NOTE: the service role bypasses RLS by design. Server code must therefore
-- always filter by tenant_id explicitly — see lib/tenant.ts.
