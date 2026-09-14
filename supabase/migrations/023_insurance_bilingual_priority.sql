-- Recruiting-language priority is independent of company-fit qualification.
-- It changes ordering, never permission to send and never the buyer pipeline.
begin;
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
commit;
