-- Insurance-only company targeting. Existing source scores are not company-fit evidence.
begin;
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
commit;
