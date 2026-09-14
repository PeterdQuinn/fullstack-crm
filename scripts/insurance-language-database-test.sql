-- Run against a disposable database after migrations 018, 020, 021, 022, 023.
-- Fixtures and settings are rolled back. No email provider is called.
begin;
do $$
declare
  known uuid := gen_random_uuid(); possible uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  excluded uuid := gen_random_uuid(); person insurance_prospects; result jsonb; ids uuid[];
  before_counts jsonb; config jsonb := '{"enabled":true,"preferred_languages":[]}';
  evidence jsonb; assessment jsonb;
begin
  update insurance_settings set recruiting_languages=config, targeting='{}', min_score=40 where id='owner';
  before_counts := public.insurance_recruiting_queue('all',100,0)->'counts';
  evidence := jsonb_build_object('status','supported','languages',jsonb_build_array('English','Spanish'),
    'quote','Dana Reyes speaks English and Spanish','source_url','https://example.com/dana','source_kind','webpage','attribution','individual');
  assessment := jsonb_build_object('version',1,'subject_name','Dana Reyes','checked_at',now(),'page_checked',true,'status','supported','languages',jsonb_build_array('English','Spanish'),'evidence',jsonb_build_array(evidence));
  insert into insurance_prospects(id,track,state,name,source,source_key,email,phone,stage,score,language_assessment,created_at) values
    (known,'recruiting','AZ','Dana Reyes','{"url":"https://example.com/dana","snippet":"test"}',known::text,'dana@example.com','602-555-0100','Qualified',100,assessment,'1900-01-01'),
    (possible,'recruiting','AZ','Pat Smith','{"url":"https://example.com/pat"}',possible::text,'pat@example.com','','Research',100,
      jsonb_build_object('version',1,'subject_name','Pat Smith','checked_at',now(),'status','possible','evidence',jsonb_build_array(evidence||'{"status":"possible","attribution":"unclear"}'::jsonb)),'1900-01-01'),
    (other,'recruiting','AZ','Alex Lane','{"url":"https://example.com/alex"}',other::text,'alex@example.com','','Research',100,null,'1900-01-01'),
    (excluded,'recruiting','AZ','Dana Reyes','{"url":"https://example.com/duplicate"}',excluded::text,'duplicate@example.com','','Research',100,assessment,'1900-01-01');
  update insurance_prospects set duplicate_of=known where id=excluded;
  select * into person from insurance_prospects where id=known;
  if public.insurance_language_priority(person,config) <> 0 then raise exception 'Bilingual person must rank first'; end if;
  if public.insurance_language_priority(person,'{"enabled":true,"preferred_languages":["English","Spanish"]}') <> 0 then raise exception 'Same-statement language pair must match'; end if;
  if public.insurance_language_priority(person,'{"enabled":true,"preferred_languages":["French"]}') <> 2 then raise exception 'Different language preference must not match'; end if;
  if public.insurance_language_priority(person,'{"enabled":false}') <> 2 then raise exception 'Disabled targeting must not prioritize'; end if;
  person.name := 'Different Person';
  if public.insurance_language_priority(person,config) <> 2 then raise exception 'Changed identity must invalidate evidence'; end if;
  person.name := 'Dana Reyes';
  person.language_assessment := jsonb_set(assessment,'{checked_at}',to_jsonb(now()-interval '31 days'));
  if public.insurance_language_priority(person,config) <> 2 then raise exception 'Expired evidence must not prioritize'; end if;
  person.language_assessment := jsonb_set(assessment,'{checked_at}',to_jsonb(now()+interval '1 day'));
  if public.insurance_language_priority(person,config) <> 2 then raise exception 'Future evidence must not prioritize'; end if;
  person.language_assessment := assessment; person.track := 'buyers';
  if public.insurance_language_priority(person,config) <> 2 then raise exception 'Buyer language must not be inferred'; end if;
  result := public.insurance_recruiting_queue('all',1,0);
  if result->'prospects'->0->>'id' <> known::text then raise exception 'Priority must happen before LIMIT'; end if;
  if (result->'counts'->>'bilingual')::int <> (before_counts->>'bilingual')::int+1 then raise exception 'Count must include all eligible bilingual records, excluding duplicates'; end if;
  if (result->'counts'->>'possible')::int <> (before_counts->>'possible')::int+1 then raise exception 'Possible evidence count mismatch'; end if;
  if (result->'counts'->>'other')::int <> (before_counts->>'other')::int+1 then raise exception 'Unknown records must be retained'; end if;
  result := public.insurance_recruiting_queue('possible',1,0);
  if result->'prospects'->0->>'id' <> possible::text then raise exception 'Possible filter must precede LIMIT'; end if;
  result := public.insurance_recruiting_queue('other',1,0);
  if result->'prospects'->0->>'id' <> other::text then raise exception 'Other filter must retain unknown candidates'; end if;
  if (public.insurance_recruiting_queue('all',1,1)->'prospects'->0->>'id') = known::text then raise exception 'Offset must advance the queue'; end if;
  select array_agg(id) into ids from public.insurance_first_touches(1);
  if ids[1] <> known then raise exception 'First-touch queue must prioritize bilingual eligible producers'; end if;
  -- Complete contact records still need a first language page check.
  update insurance_prospects set phone='602-555-0199',language_assessment=null where id=other;
  if not exists(select 1 from public.insurance_enrichment_candidates(20) where id=other) then raise exception 'Complete contacts must enter language research'; end if;
  update insurance_prospects set enriched_at=now() where id=other;
  if exists(select 1 from public.insurance_enrichment_candidates(20) where id=other) then raise exception 'Enrichment cooldown must prevent repeat starvation'; end if;
  update insurance_prospects set opt_out=true where id=known;
  if exists(select 1 from jsonb_array_elements(public.insurance_recruiting_queue('bilingual',100,0)->'prospects') r where r->>'id'=known::text) then raise exception 'Opt-outs must not enter recruiting queue'; end if;
end $$;
rollback;
