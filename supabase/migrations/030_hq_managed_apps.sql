-- Apply to the FSS/HQ database, not the separate insurance database.
begin;

create table if not exists public.managed_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  application_type text not null default 'external',
  production_url text check (production_url is null or production_url ~ '^https://'),
  github_repo text check (github_repo is null or github_repo ~ '^https://github.com/'),
  vercel_project text check (vercel_project is null or vercel_project ~ '^https://vercel.com/'),
  status text not null default 'registered' check (status in ('registered','active','maintenance','retired')),
  enabled boolean not null default true,
  health_status text not null default 'unknown' check (health_status in ('unknown','healthy','degraded','unavailable')),
  health_checked_at timestamptz,
  last_deployment_at timestamptz,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The existing owner login is server-authenticated. No browser role receives
-- access to this operational registry, and it contains no credentials.
alter table public.managed_apps enable row level security;
revoke all on public.managed_apps from public, anon, authenticated;
grant select, insert, update, delete on public.managed_apps to service_role;

create or replace function public.hq_touch_managed_app() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.hq_touch_managed_app() from public, anon, authenticated;
drop trigger if exists hq_managed_apps_updated_at on public.managed_apps;
create trigger hq_managed_apps_updated_at before update on public.managed_apps
for each row execute function public.hq_touch_managed_app();

insert into public.managed_apps
  (name,slug,description,application_type,production_url,github_repo,vercel_project,metadata)
values
  ('Full Stack HQ','fullstack-hq','Full Stack Services command center, CRM and insurance operations.',
   'control_plane','https://fullstack-crm-nine.vercel.app','https://github.com/PeterdQuinn/fullstack-crm',
   'https://vercel.com/peterdquinns-projects/fullstack-crm','{"integration_state":"native","internal_route":"/home"}'),
  ('peter-insurance','peter-insurance','Existing insurance property. External feature audit pending; operational insurance pipeline is in HQ.',
   'external',null,null,'https://vercel.com/peterdquinns-projects/peter-insurance','{"integration_state":"audit_pending"}'),
  ('hvac-2026','hvac-2026','Existing HVAC application. Job, dispatch and billing integration pending source audit.',
   'external','https://hvac-2026.vercel.app/dashboard',null,'https://vercel.com/peterdquinns-projects/hvac-2026','{"integration_state":"public_demo","workspace_id":"full_stack","business_unit":"hvac"}')
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
commit;
