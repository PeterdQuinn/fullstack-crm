-- Apply ONLY to the separate insurance database, after insurance schema setup.
begin;
do $$
declare t text;
begin
  foreach t in array array['insurance_prospects','insurance_activities','insurance_tasks','insurance_email_outbox'] loop
    execute format('alter table public.%I add column if not exists workspace_id text not null default ''peter_quinn'', add column if not exists business_unit text not null default ''insurance''',t);
    if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.' || t) and conname=t || '_hq_context') then
      execute format('alter table public.%I add constraint %I check (workspace_id=''peter_quinn'' and business_unit=''insurance'')',t,t || '_hq_context');
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
