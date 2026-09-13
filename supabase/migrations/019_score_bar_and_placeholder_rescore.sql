-- The send bar moved from 50 to 20; the database held its own copy of the old
-- one. save_automation_score promoted a lead to 'Ready for Outreach' only when
-- points > 50 and parked everything else at 'Scored', which is not a sendable
-- status — so lowering the bar in the application alone would have changed
-- nothing for any newly scored lead.
--
-- An exact 50 stays out. It is the literal value lib/ai-scoring.ts writes when
-- every provider is down: 24 of the 25 rows holding it were written during the
-- 2026-08-16..18 outage and read "Unable to determine". Those leads need
-- re-scoring, not mailing, which is what the placeholder pass in
-- app/api/cron/process-discovered-leads does.
create or replace function save_automation_score(p_lead_id uuid, p_score jsonb) returns void
language plpgsql set search_path = public as $$
declare old_state text; new_state text; points integer;
begin
  select status into old_state from leads where id=p_lead_id for update;
  if not found then raise exception 'Lead missing'; end if;
  if coalesce(p_score->>'provider','fallback')='fallback' then raise exception 'Real provider score required'; end if;
  points := (p_score->>'lead_score')::integer;
  if points is null or points<0 or points>100 then raise exception 'Invalid score'; end if;
  insert into lead_ai_summaries(lead_id,lead_score,confidence_level,main_pain_point,best_attack_angle,recommended_first_message,recommended_follow_up,missing_data_needed)
    values(p_lead_id,points,coalesce(p_score->>'confidence_level','medium'),p_score->>'main_pain_point',p_score->>'best_attack_angle',p_score->>'recommended_first_message',p_score->>'recommended_follow_up',p_score->'missing_data_needed')
    on conflict(lead_id) do update set lead_score=excluded.lead_score,confidence_level=excluded.confidence_level,main_pain_point=excluded.main_pain_point,best_attack_angle=excluded.best_attack_angle,recommended_first_message=excluded.recommended_first_message,recommended_follow_up=excluded.recommended_follow_up,missing_data_needed=excluded.missing_data_needed,updated_at=now();
  if old_state in ('New','Scored') then
    new_state := case when points >= 20 and points <> 50 then 'Ready for Outreach' else 'Scored' end;
    update leads set status=new_state,updated_at=now() where id=p_lead_id;
    if old_state<>new_state then
      insert into status_audit_log(lead_id,changed_by,field_changed,old_status,new_status,reason)
      values(p_lead_id,'automation','status',old_state,new_state,'Score and lead status saved together');
    end if;
  end if;
end $$;
revoke all on function save_automation_score(uuid,jsonb) from public, anon, authenticated;
grant execute on function save_automation_score(uuid,jsonb) to service_role;
