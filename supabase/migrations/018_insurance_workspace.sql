-- Insurance research stays outside leads and the HVAC email automations.
begin;
create table if not exists public.insurance_prospects (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('recruiting','buyers')),
  state text not null check (state in ('AZ','SC','VA','OH','MI')),
  name text not null,
  source jsonb not null,
  source_key text not null,
  email text not null default '',
  phone text not null default '',
  npn text not null default '',
  first_licensed_on date,
  license_source_url text not null default '',
  stage text not null default 'Research',
  notes text not null default '',
  next_follow_up date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(track, state, source_key)
);
create index if not exists insurance_prospects_track_updated on public.insurance_prospects(track, updated_at desc);
create table if not exists public.insurance_search_cache (
  key text primary key,
  result jsonb not null,
  expires_at timestamptz not null
);
create table if not exists public.insurance_api_usage (
  provider text not null,
  month text not null,
  used integer not null default 0,
  primary key(provider, month)
);
alter table public.insurance_prospects enable row level security;
alter table public.insurance_search_cache enable row level security;
alter table public.insurance_api_usage enable row level security;
revoke all on public.insurance_prospects, public.insurance_search_cache, public.insurance_api_usage from anon, authenticated;
grant all on public.insurance_prospects, public.insurance_search_cache, public.insurance_api_usage to service_role;

create or replace function public.reserve_insurance_request(p_provider text, p_month text, p_cap integer)
returns boolean language plpgsql set search_path = public as $$
declare reserved boolean := false;
begin
  if p_provider not in ('serpapi','ollama','gemini') or p_cap < 1 or p_cap > 100 then
    raise exception 'Invalid insurance usage reservation';
  end if;
  insert into insurance_api_usage(provider, month) values(p_provider, p_month) on conflict do nothing;
  update insurance_api_usage set used = used + 1
    where provider = p_provider and month = p_month and used < p_cap
    returning true into reserved;
  return coalesce(reserved, false);
end $$;
revoke all on function public.reserve_insurance_request(text,text,integer) from public, anon, authenticated;
grant execute on function public.reserve_insurance_request(text,text,integer) to service_role;
commit;
