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
