-- FSS/HQ database only. Insurance context is a separate database migration.
begin;
create table if not exists public.hq_workspaces (
  id text primary key check (id in ('full_stack','peter_quinn')),
  name text not null
);
insert into public.hq_workspaces values ('full_stack','Full Stack Services'),('peter_quinn','Peter Quinn / Insurance') on conflict do nothing;
create table if not exists public.hq_business_units (
  workspace_id text not null references public.hq_workspaces(id),
  id text not null,
  name text not null,
  primary key(workspace_id,id),
  check ((workspace_id='full_stack' and id in ('full_stack_core','hvac')) or (workspace_id='peter_quinn' and id='insurance'))
);
insert into public.hq_business_units values ('full_stack','full_stack_core','Full Stack Services'),('full_stack','hvac','HVAC'),('peter_quinn','insurance','Insurance') on conflict do nothing;
create table if not exists public.hq_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  business_unit text not null,
  record_type text not null check (record_type in ('contact','client','email','campaign','proposal','rfp','document','contract','project','task','activity','invoice','appointment','opportunity','note','case','carrier_note','training','job','dispatch')),
  owner_id text not null,
  title text not null check (length(btrim(title)) between 1 and 300),
  body text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  related_contact_id text,
  related_company_id text,
  related_project_id text,
  related_record_id text,
  due_at timestamptz,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object'),
  storage_path text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,business_unit) references public.hq_business_units(workspace_id,id)
);
create index if not exists hq_records_context on public.hq_records(workspace_id,business_unit,record_type,updated_at desc);
create index if not exists hq_records_due on public.hq_records(due_at) where status='open';
create index if not exists hq_records_search on public.hq_records using gin(to_tsvector('simple',title || ' ' || body));
create index if not exists hq_records_contact on public.hq_records(related_contact_id);
create index if not exists hq_records_project on public.hq_records(related_project_id);

-- Existing inserts inherit Full Stack/core. Do not infer HVAC from a niche.
do $$
declare t text;
begin
  foreach t in array array['leads','call_logs','lead_notes','appointments','outreach_log','follow_up_tasks','email_outbox'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists workspace_id text not null default ''full_stack'', add column if not exists business_unit text not null default ''full_stack_core''',t);
      if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.' || t) and conname=t || '_hq_context') then
        execute format('alter table public.%I add constraint %I check (workspace_id = ''full_stack'' and business_unit in (''full_stack_core'',''hvac''))',t,t || '_hq_context');
      end if;
    end if;
  end loop;
end $$;

-- Child activity inherits its lead's context, including HVAC, for old writers.
create or replace function public.hq_lead_context() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.lead_id is not null then
    select workspace_id,business_unit into new.workspace_id,new.business_unit
      from public.leads where id=new.lead_id;
    if not found then raise exception 'Related lead is missing'; end if;
  end if;
  return new;
end $$;
revoke all on function public.hq_lead_context() from public,anon,authenticated;
do $$
declare t text;
begin
  foreach t in array array['call_logs','lead_notes','appointments','outreach_log','follow_up_tasks','email_outbox'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists hq_inherit_lead_context on public.%I',t);
      execute format('create trigger hq_inherit_lead_context before insert or update on public.%I for each row execute function public.hq_lead_context()',t);
    end if;
  end loop;
end $$;

alter table public.hq_workspaces enable row level security;
alter table public.hq_business_units enable row level security;
alter table public.hq_records enable row level security;
revoke all on public.hq_workspaces,public.hq_business_units,public.hq_records from public,anon,authenticated;
grant select on public.hq_workspaces,public.hq_business_units to service_role;
grant select,insert,update,delete on public.hq_records to service_role;

-- Private file objects are served only through owner-authenticated routes.
insert into storage.buckets(id,name,public,file_size_limit)
values ('hq-documents','hq-documents',false,4194304)
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit;
notify pgrst,'reload schema';
commit;
