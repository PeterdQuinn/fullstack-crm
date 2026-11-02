-- Forward-only standalone insurance reconciliation for databases missing 018-024.
-- Also safe on a fully migrated database: rows and owner settings are preserved.
-- For a database missing the base tables, apply this file explicitly BEFORE
-- replaying historical migrations (022 references the outbox created by 024).
begin;

-- Insurance research stays outside leads and the HVAC email automations.
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

-- ProducerForge-only insurance state. This migration deliberately has no
-- references to the Full Stack Services leads, outbox, or automation tables.
alter table public.insurance_prospects
  add column if not exists company text not null default '', add column if not exists title text not null default '',
  add column if not exists city text not null default '', add column if not exists website text not null default '',
  add column if not exists score integer, add column if not exists score_reason text not null default '',
  add column if not exists score_confidence text not null default '', add column if not exists scored_at timestamptz,
  add column if not exists enriched_at timestamptz, add column if not exists email_sent_count integer not null default 0,
  add column if not exists last_contacted_at timestamptz, add column if not exists replied_at timestamptz,
  add column if not exists opt_out boolean not null default false, add column if not exists bounced boolean not null default false,
  add column if not exists complained boolean not null default false, add column if not exists suppression_reason text not null default '',
  add column if not exists suppressed_at timestamptz, add column if not exists discovered_by text not null default 'manual',
  add column if not exists duplicate_of uuid references public.insurance_prospects(id), add column if not exists fit_assessment jsonb;
create table if not exists public.insurance_activities (id uuid primary key default gen_random_uuid(), prospect_id uuid references public.insurance_prospects(id) on delete cascade, kind text not null, summary text not null, detail jsonb not null default '{}', actor text not null default 'automation', created_at timestamptz not null default now());
create table if not exists public.insurance_tasks (id uuid primary key default gen_random_uuid(), prospect_id uuid references public.insurance_prospects(id) on delete cascade, task_type text not null, due_at timestamptz not null, status text not null default 'pending', notes text not null default '', completed_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.insurance_settings (id text primary key, enabled boolean not null default false, sending_enabled boolean not null default false, autopilot boolean not null default false, tracks text[] not null default array['recruiting','buyers'], states text[] not null default array['AZ','SC','VA','OH','MI'], queries jsonb not null default '[]', daily_send_cap integer not null default 10, sequence_gap_days integer not null default 4, min_score integer not null default 40, recruiting_languages jsonb not null default '{"enabled":true,"preferred_languages":[]}', targeting jsonb not null default '{}', updated_at timestamptz not null default now());
insert into public.insurance_settings(id) values ('owner') on conflict do nothing;
create table if not exists public.insurance_email_outbox (id uuid primary key default gen_random_uuid(), idempotency_key text unique not null, insurance_prospect_id uuid references public.insurance_prospects(id), message_type text not null, recipient text not null, sender text not null, reply_to text, subject text not null, html text not null, body_text text not null, source text not null default 'owner', status text not null default 'queued', attempts integer not null default 0, provider_message_id text, error_message text, created_at timestamptz not null default now(), last_attempt_at timestamptz, finalized_at timestamptz);

alter table public.insurance_prospects
  add column if not exists duplicate_reason text not null default '',
  add column if not exists language_assessment jsonb,
  add column if not exists licenses jsonb not null default '[]';
alter table public.insurance_settings
  add column if not exists cursor integer not null default 0;
alter table public.insurance_email_outbox
  add column if not exists send_limit integer not null default 40;

-- Insurance-only company targeting. Existing source scores are not company-fit evidence.
alter table public.insurance_settings add column if not exists targeting jsonb not null default '{}';
alter table public.insurance_prospects add column if not exists fit_assessment jsonb;

create or replace function public.save_insurance_targeting(p_track text, p_profile jsonb) returns void
language plpgsql set search_path = public as $$
begin
  if p_track not in ('recruiting','buyers') or jsonb_typeof(p_profile) <> 'object'
     or coalesce(p_profile->>'company','') = '' or coalesce(p_profile->>'offer','') = '' then
    raise exception 'Invalid insurance target profile';
  end if;
  update insurance_settings set targeting=jsonb_set(targeting,array[p_track],p_profile), updated_at=now() where id='owner';
  if not found then raise exception 'Insurance settings are missing'; end if;
end $$;
revoke all on function public.save_insurance_targeting(text,jsonb) from public, anon, authenticated;
grant execute on function public.save_insurance_targeting(text,jsonb) to service_role;

create or replace function public.save_insurance_score(p_id uuid, p_score jsonb) returns void
language plpgsql set search_path = public as $$
declare record insurance_prospects; points integer; next_stage text;
begin
  select * into record from insurance_prospects where id=p_id for update;
  if not found then raise exception 'Insurance prospect is missing'; end if;
  if coalesce(p_score->>'provider','fallback')='fallback' then raise exception 'Real provider score required'; end if;
  points := (p_score->>'score')::integer;
  if points is null or points<0 or points>100 then raise exception 'Invalid insurance score'; end if;

  update insurance_prospects set
    score=points,
    score_reason=coalesce(p_score->>'reason',''),
    score_confidence=coalesce(p_score->>'confidence','medium'),
    scored_at=now(),
    updated_at=now()
  where id=p_id;

  -- Only a record still sitting in Research is moved. A human who has already
  -- advanced the stage outranks the model.
  if record.stage in ('Research','Qualified') then
    next_stage := case when points >= (select min_score from insurance_settings where id='owner')
      and ((select targeting->record.track from insurance_settings where id='owner') is null
        or (record.fit_assessment->>'verdict' = 'potential_fit'
            and (record.fit_assessment->>'profile_key')::jsonb = (select targeting->record.track from insurance_settings where id='owner'))) then 'Qualified' else 'Research' end;
    if next_stage <> record.stage then
      update insurance_prospects set stage=next_stage where id=p_id;
      insert into insurance_activities(prospect_id,kind,summary,detail)
        values(p_id,'stage',next_stage||' after score '||points, jsonb_build_object('from',record.stage,'to',next_stage,'score',points));
    end if;
  end if;
  insert into insurance_activities(prospect_id,kind,summary,detail)
    values(p_id,'scored','Scored '||points||' ('||coalesce(p_score->>'confidence','medium')||' confidence)', p_score);
end $$;
revoke all on function public.save_insurance_score(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_insurance_score(uuid,jsonb) to service_role;


-- Filter before LIMIT so previously assessed records cannot starve new candidates.
create or replace function public.insurance_fit_candidates(p_id uuid default null, p_limit integer default 20)
returns setof insurance_prospects language sql stable set search_path = public as $$
  select p.* from insurance_prospects p cross join insurance_settings s
  where s.id='owner' and p.duplicate_of is null and not p.opt_out and p.stage <> 'Do not contact'
    and (p_id is null or p.id=p_id)
    and (p_id is not null or case when s.targeting->p.track is null then p.score is null else
      p.fit_assessment is null
      or (p.fit_assessment->>'profile_key')::jsonb is distinct from s.targeting->p.track
      or (p.fit_assessment->>'subject_key')::jsonb is distinct from jsonb_build_array(p.name,p.state,p.track,p.source->>'url',p.source->>'snippet')
      or coalesce((p.fit_assessment->>'assessed_at')::timestamptz, '-infinity'::timestamptz) < now()-interval '30 days'
      or (p.fit_assessment->>'assessed_at')::timestamptz > now()
    end)
  order by case when btrim(p.email) <> '' then 0 when btrim(p.phone) <> '' then 1 else 2 end,
    p.scored_at asc nulls first, p.created_at asc
  limit greatest(1,least(p_limit,20));
$$;
revoke all on function public.insurance_fit_candidates(uuid,integer) from public, anon, authenticated;
grant execute on function public.insurance_fit_candidates(uuid,integer) to service_role;

-- Exclude stale/unsupported fit before limiting the send queue.
create or replace function public.insurance_first_touches(p_limit integer default 8)
returns setof insurance_prospects language sql stable set search_path = public as $$
  select p.* from insurance_prospects p cross join insurance_settings s
  where s.id='owner' and p.stage='Qualified' and p.duplicate_of is null
    and p.email_sent_count=0 and not p.opt_out and not p.bounced and not p.complained
    and btrim(p.email) <> '' and p.score >= s.min_score and p.replied_at is null
    and (s.targeting->p.track is null or (
      p.fit_assessment->>'version' = '1' and p.fit_assessment->>'verdict' = 'potential_fit'
      and (p.fit_assessment->>'profile_key')::jsonb = s.targeting->p.track
      and (p.fit_assessment->>'subject_key')::jsonb = jsonb_build_array(p.name,p.state,p.track,p.source->>'url',p.source->>'snippet')
      and (p.fit_assessment->>'assessed_at')::timestamptz between now()-interval '30 days' and now()
    ))
  order by p.score desc, p.created_at asc limit greatest(1,least(p_limit,20));
$$;
revoke all on function public.insurance_first_touches(integer) from public, anon, authenticated;
grant execute on function public.insurance_first_touches(integer) to service_role;

-- Last-mile check also covers already saved messages replayed by outbox recovery.
-- HVAC rows return immediately. An unconfigured insurance track keeps its existing behavior.
create or replace function public.check_insurance_company_fit() returns trigger
language plpgsql set search_path = public as $$
declare person insurance_prospects; profile jsonb; fit jsonb;
begin
  if new.insurance_prospect_id is null or new.status <> 'sending'
     or new.message_type not like 'insurance_touch_%' then return new; end if;
  select * into person from insurance_prospects where id=new.insurance_prospect_id;
  select targeting->person.track into profile from insurance_settings where id='owner';
  if profile is null then return new; end if;
  fit := person.fit_assessment;
  if fit is null or fit->>'version' is distinct from '1'
     or fit->>'verdict' is distinct from 'potential_fit'
     or (fit->>'profile_key')::jsonb is distinct from profile
     or (fit->>'subject_key')::jsonb is distinct from jsonb_build_array(person.name,person.state,person.track,person.source->>'url',person.source->>'snippet')
     or (fit->>'assessed_at')::timestamptz is null
     or (fit->>'assessed_at')::timestamptz < now()-interval '30 days'
     or (fit->>'assessed_at')::timestamptz > now() then
    raise exception 'Insurance company fit needs research before outreach';
  end if;
  return new;
end $$;
revoke all on function public.check_insurance_company_fit() from public, anon, authenticated;
drop trigger if exists insurance_company_fit_before_send on public.insurance_email_outbox;
create trigger insurance_company_fit_before_send before insert or update of status on public.insurance_email_outbox
for each row execute function public.check_insurance_company_fit();

-- Recruiting-language priority is independent of company-fit qualification.
-- It changes ordering, never permission to send and never the buyer pipeline.
alter table public.insurance_settings
  add column if not exists recruiting_languages jsonb not null default '{"enabled":true,"preferred_languages":[]}';
alter table public.insurance_prospects add column if not exists language_assessment jsonb;

create or replace function public.insurance_language_priority(p insurance_prospects, config jsonb)
returns integer language plpgsql stable set search_path = public as $$
declare a jsonb := p.language_assessment; evidence jsonb; preferred jsonb;
begin
  if p.track <> 'recruiting' or coalesce(config->>'enabled','true') = 'false' then return 2; end if;
  if a is null or a->>'version' is distinct from '1' or a->>'subject_name' is distinct from p.name
     or a->>'checked_at' is null or (a->>'checked_at')::timestamptz < now()-interval '30 days'
     or (a->>'checked_at')::timestamptz > now() then return 2; end if;
  preferred := coalesce(config->'preferred_languages','[]'::jsonb);
  for evidence in select value from jsonb_array_elements(coalesce(a->'evidence','[]'::jsonb)) loop
    if evidence->>'status' = 'supported' and coalesce(evidence->'languages','[]'::jsonb) @> preferred then return 0; end if;
  end loop;
  for evidence in select value from jsonb_array_elements(coalesce(a->'evidence','[]'::jsonb)) loop
    if evidence->>'status' = 'possible' or (evidence->>'status' = 'supported' and evidence->'languages' = '[]'::jsonb) then return 1; end if;
  end loop;
  return 2;
end $$;
revoke all on function public.insurance_language_priority(insurance_prospects,jsonb) from public, anon, authenticated;
grant execute on function public.insurance_language_priority(insurance_prospects,jsonb) to service_role;

-- Include old complete-contact records so their language evidence gets researched.
create or replace function public.insurance_enrichment_candidates(p_limit integer default 8)
returns setof insurance_prospects language sql stable set search_path = public as $$
  select p.* from insurance_prospects p cross join insurance_settings s
  where s.id='owner' and p.duplicate_of is null and not p.opt_out and p.stage <> 'Do not contact'
    and (btrim(p.email)='' or btrim(p.phone)='' or (p.track='recruiting' and (
      p.language_assessment is null or coalesce(p.language_assessment->>'page_checked','false') <> 'true' or p.language_assessment->>'subject_name' is distinct from p.name
      or coalesce((p.language_assessment->>'checked_at')::timestamptz,'-infinity'::timestamptz) < now()-interval '30 days'
    )))
  -- Evidence-first within records due for work. A six-hour cooldown prevents an
  -- unreachable high-priority profile occupying every batch indefinitely.
    and (p.track <> 'recruiting' or p.enriched_at is null or p.enriched_at < now()-interval '6 hours')
  order by public.insurance_language_priority(p,s.recruiting_languages), p.updated_at asc
  limit greatest(1,least(p_limit,20));
$$;
revoke all on function public.insurance_enrichment_candidates(integer) from public, anon, authenticated;
grant execute on function public.insurance_enrichment_candidates(integer) to service_role;

-- Existing eligibility conditions are retained; priority is applied before LIMIT.
create or replace function public.insurance_fit_candidates(p_id uuid default null, p_limit integer default 20)
returns setof insurance_prospects language sql stable set search_path = public as $$
  select p.* from insurance_prospects p cross join insurance_settings s
  where s.id='owner' and p.duplicate_of is null and not p.opt_out and p.stage <> 'Do not contact'
    and (p_id is null or p.id=p_id)
    and (p_id is not null or case when s.targeting->p.track is null then p.score is null else
      p.fit_assessment is null
      or (p.fit_assessment->>'profile_key')::jsonb is distinct from s.targeting->p.track
      or (p.fit_assessment->>'subject_key')::jsonb is distinct from jsonb_build_array(p.name,p.state,p.track,p.source->>'url',p.source->>'snippet')
      or coalesce((p.fit_assessment->>'assessed_at')::timestamptz, '-infinity'::timestamptz) < now()-interval '30 days'
      or (p.fit_assessment->>'assessed_at')::timestamptz > now()
    end)
  order by public.insurance_language_priority(p,s.recruiting_languages), case when btrim(p.email) <> '' then 0 when btrim(p.phone) <> '' then 1 else 2 end,
    p.scored_at asc nulls first, p.created_at asc
  limit greatest(1,least(p_limit,20));
$$;
revoke all on function public.insurance_fit_candidates(uuid,integer) from public, anon, authenticated;
grant execute on function public.insurance_fit_candidates(uuid,integer) to service_role;

-- Exclude stale/unsupported fit before limiting the send queue.
create or replace function public.insurance_first_touches(p_limit integer default 8)
returns setof insurance_prospects language sql stable set search_path = public as $$
  select p.* from insurance_prospects p cross join insurance_settings s
  where s.id='owner' and p.stage='Qualified' and p.duplicate_of is null
    and p.email_sent_count=0 and not p.opt_out and not p.bounced and not p.complained
    and btrim(p.email) <> '' and p.score >= s.min_score and p.replied_at is null
    and (s.targeting->p.track is null or (
      p.fit_assessment->>'version' = '1' and p.fit_assessment->>'verdict' = 'potential_fit'
      and (p.fit_assessment->>'profile_key')::jsonb = s.targeting->p.track
      and (p.fit_assessment->>'subject_key')::jsonb = jsonb_build_array(p.name,p.state,p.track,p.source->>'url',p.source->>'snippet')
      and (p.fit_assessment->>'assessed_at')::timestamptz between now()-interval '30 days' and now()
    ))
  order by public.insurance_language_priority(p,s.recruiting_languages), p.score desc, p.created_at asc limit greatest(1,least(p_limit,20));
$$;
revoke all on function public.insurance_first_touches(integer) from public, anon, authenticated;
grant execute on function public.insurance_first_touches(integer) to service_role;

-- Used by the existing workspace, keeping the groups in backend order.
create or replace function public.insurance_workspace_prospects(p_limit integer default 600)
returns setof insurance_prospects language sql stable set search_path = public as $$
  select p.* from insurance_prospects p cross join insurance_settings s
  where s.id='owner' and p.duplicate_of is null
  order by public.insurance_language_priority(p,s.recruiting_languages), p.updated_at desc, p.id
  limit greatest(1,least(p_limit,600));
$$;
revoke all on function public.insurance_workspace_prospects(integer) from public, anon, authenticated;
grant execute on function public.insurance_workspace_prospects(integer) to service_role;

-- Filter and paginate at the database, with counts over the complete active queue.
create or replace function public.insurance_recruiting_queue(p_group text default 'all', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable set search_path = public as $$
declare result jsonb;
begin
  if p_group not in ('all','bilingual','possible','other') then raise exception 'Invalid language group'; end if;
  with ranked as (
    select p.*, public.insurance_language_priority(p,s.recruiting_languages) as language_priority
    from insurance_prospects p cross join insurance_settings s
    where s.id='owner' and p.track='recruiting' and p.duplicate_of is null and not p.opt_out
      and not p.bounced and not p.complained
      and p.stage not in ('Do not contact','Not now','Active')
  ), filtered as (
    select * from ranked where p_group='all' or language_priority=case p_group when 'bilingual' then 0 when 'possible' then 1 else 2 end
  ), page as (
    select * from filtered order by language_priority, score desc nulls last, created_at, id
      limit greatest(1,least(p_limit,100)) offset greatest(0,least(p_offset,100000))
  )
  select jsonb_build_object(
    'prospects',coalesce((select jsonb_agg(to_jsonb(page) order by language_priority, score desc nulls last, created_at, id) from page),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'counts',jsonb_build_object('bilingual',(select count(*) from ranked where language_priority=0),
      'possible',(select count(*) from ranked where language_priority=1),'other',(select count(*) from ranked where language_priority=2)),
    'limit',greatest(1,least(p_limit,100)), 'offset',greatest(0,least(p_offset,100000))
  ) into result;
  return result;
end $$;
revoke all on function public.insurance_recruiting_queue(text,integer,integer) from public, anon, authenticated;
grant execute on function public.insurance_recruiting_queue(text,integer,integer) to service_role;

-- Compatibility overload for the original ProducerForge settings column.
create or replace function public.insurance_language_priority(p insurance_prospects, config text[])
returns integer language sql stable set search_path = public as $$ select 2 $$;
revoke all on function public.insurance_language_priority(insurance_prospects,text[]) from public, anon, authenticated;
grant execute on function public.insurance_language_priority(insurance_prospects,text[]) to service_role;

alter table public.insurance_settings add column if not exists cursor integer not null default 0;
create or replace function public.next_insurance_target() returns jsonb
language plpgsql set search_path = public as $$
declare settings insurance_settings; chosen_track text; chosen_state text;
begin
  select * into settings from insurance_settings where id='owner' for update;
  if not found then raise exception 'Insurance settings are missing'; end if;
  if cardinality(settings.tracks)=0 or cardinality(settings.states)=0 then raise exception 'Insurance targeting has no track or state saved'; end if;
  chosen_track := settings.tracks[1 + settings.cursor % cardinality(settings.tracks)];
  chosen_state := settings.states[1 + ((settings.cursor / cardinality(settings.tracks)) % cardinality(settings.states))];
  update insurance_settings set cursor=cursor+1, updated_at=now() where id='owner';
  return jsonb_build_object('track', chosen_track, 'state', chosen_state, 'cursor', settings.cursor);
end $$;
revoke all on function public.next_insurance_target() from public, anon, authenticated;
grant execute on function public.next_insurance_target() to service_role;

-- Standalone multi-license model. NIPR is optional; public/state evidence is enough.
alter table public.insurance_prospects add column if not exists licenses jsonb not null default '[]';
create index if not exists insurance_prospects_licenses on public.insurance_prospects using gin (licenses);

-- Standalone tables must receive the same access restrictions as the workspace.
alter table public.insurance_activities enable row level security;
alter table public.insurance_tasks enable row level security;
alter table public.insurance_settings enable row level security;
alter table public.insurance_email_outbox enable row level security;
revoke all on public.insurance_activities, public.insurance_tasks,
  public.insurance_settings, public.insurance_email_outbox from anon, authenticated;
grant all on public.insurance_activities, public.insurance_tasks,
  public.insurance_settings, public.insurance_email_outbox to service_role;

create index if not exists insurance_prospects_active on public.insurance_prospects(track, stage) where duplicate_of is null;
create index if not exists insurance_activities_prospect on public.insurance_activities(prospect_id, created_at desc);
create index if not exists insurance_tasks_due on public.insurance_tasks(status, due_at);

notify pgrst, 'reload schema';
commit;
