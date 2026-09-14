-- Compatibility overload for the original ProducerForge settings column.
create or replace function public.insurance_language_priority(p insurance_prospects, config text[])
returns integer language sql stable set search_path = public as $$ select 2 $$;
revoke all on function public.insurance_language_priority(insurance_prospects,text[]) from public, anon, authenticated;
grant execute on function public.insurance_language_priority(insurance_prospects,text[]) to service_role;
