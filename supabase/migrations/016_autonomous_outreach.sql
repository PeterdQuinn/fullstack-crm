-- Additive persistence for the existing owner workspace. Browser clients have
-- no access; server APIs still require the CRM login or cron secret.
create table if not exists automation_settings (
  id text primary key check (id = 'owner'),
  enabled boolean not null default true,
  niches text[] not null,
  locations jsonb not null default '[]',
  cursor integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into automation_settings(id, niches) values ('owner', array[
  'HVAC','Landscaping','Plumbing','Electrical contractors','Roofing','Cleaning services',
  'Auto repair','Restaurants','Dentists','Accounting firms','Law firms',
  'Real estate agencies','Property management','Gyms','Salons','Retail stores',
  'Manufacturers','Wholesale distributors','Logistics companies','Marketing agencies'
]) on conflict do nothing;
alter table automation_settings enable row level security;
revoke all on automation_settings from anon, authenticated;
grant all on automation_settings to service_role;

create or replace function next_discovery_target(p_locations jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare settings automation_settings; places jsonb; place jsonb;
begin
  select * into settings from automation_settings where id='owner' for update;
  if not found then raise exception 'Target settings are missing'; end if;
  places := case when jsonb_array_length(settings.locations)>0 then settings.locations else p_locations end;
  place := places -> ((settings.cursor / cardinality(settings.niches)) % jsonb_array_length(places));
  update automation_settings set cursor=cursor+1 where id='owner';
  return jsonb_build_object('niche',settings.niches[1 + settings.cursor % cardinality(settings.niches)],'city',place->>'city','state',place->>'state');
end $$;
revoke all on function next_discovery_target(jsonb) from public, anon, authenticated;
grant execute on function next_discovery_target(jsonb) to service_role;

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  stage text not null,
  status text not null default 'running',
  result jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table automation_runs enable row level security;
revoke all on automation_runs from anon, authenticated;
grant all on automation_runs to service_role;

create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  lead_id uuid references leads(id) on delete restrict,
  message_type text not null,
  recipient text not null,
  sender text not null,
  reply_to text not null,
  subject text not null,
  html text not null,
  body_text text not null,
  source text not null default 'automation',
  send_limit integer not null default 40,
  status text not null default 'pending',
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  provider_message_id text,
  accepted_at timestamptz,
  finalized_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_recovery on email_outbox(status, finalized_at);
alter table email_outbox enable row level security;
revoke all on email_outbox from anon, authenticated;
grant all on email_outbox to service_role;

-- A single reservation transaction serializes concurrent senders and budgets.
create or replace function claim_email_outbox(p_id uuid) returns setof email_outbox
language plpgsql set search_path = public as $$
declare item email_outbox; used integer; day_start timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('crm-email-reservations'));
  select * into item from email_outbox where id = p_id for update;
  if not found or item.status in ('sent','needs_review','cancelled') then return; end if;
  if item.status = 'sending' and item.last_attempt_at > now() - interval '3 minutes' then return; end if;
  -- Provider deduplication is time-limited. Ambiguous old sends need review,
  -- never a blind repeat after the provider forgets the idempotency key.
  if item.first_attempt_at < now() - interval '23 hours' then
    update email_outbox set status='needs_review', error_message='Unconfirmed send exceeded safe retry window' where id=p_id;
    return;
  end if;
  day_start := date_trunc('day', now() at time zone 'America/Phoenix') at time zone 'America/Phoenix';
  if item.lead_id is not null and item.first_attempt_at is null then
    select count(*) into used from outreach_log l where direction='outbound' and channel='email' and sent_at >= day_start
      and not exists (select 1 from email_outbox o where o.provider_message_id=l.provider_message_id);
    used := used + (select count(*) from email_outbox where lead_id is not null and last_attempt_at >= day_start);
    if used >= item.send_limit then return; end if;
  end if;
  return query update email_outbox set status='sending', attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,now()), last_attempt_at=now(), error_message=null
    where id=p_id returning *;
end $$;
revoke all on function claim_email_outbox(uuid) from public, anon, authenticated;
grant execute on function claim_email_outbox(uuid) to service_role;

-- Log, lead progress, audit, next task and finalization commit together.
-- A crash rolls back the whole transaction; replay does not send another email.
-- outreach_log.id is deliberately the outbox row id. That shared key is what
-- makes replay insert exactly one log row instead of one per attempt, so an
-- outbox row cannot be deleted without orphaning its outreach_log entry.
create or replace function finalize_email_outbox(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare item email_outbox; prospect leads; touch integer; next_status text; safe_progress boolean;
begin
  select * into item from email_outbox where id=p_id for update;
  if not found or item.status <> 'sent' then raise exception 'Email has not been accepted'; end if;
  if item.finalized_at is not null then return; end if;
  if item.lead_id is not null then
    select * into prospect from leads where id=item.lead_id for update;
    if not found then raise exception 'Lead is missing'; end if;
    insert into outreach_log(id,lead_id,channel,direction,message_type,subject,message_body,status,provider,provider_message_id,sent_at)
      values(item.id,item.lead_id,'email','outbound',item.message_type,item.subject,item.body_text,'sent','resend',item.provider_message_id,item.accepted_at)
      on conflict(id) do nothing;
    safe_progress := not coalesce(prospect.opt_out,false) and not coalesce(prospect.bounced,false)
      and not coalesce(prospect.complained,false) and prospect.archived_at is null;
    if item.message_type ~ '^email_[123]$' then
      touch := right(item.message_type,1)::integer;
      safe_progress := safe_progress and prospect.status in ('New','Scored','Ready for Outreach','Follow-Up Scheduled','Email 1 Sent','Email 2 Sent','Email 3 Sent')
        and coalesce(prospect.email_sent_count,0) <= touch
        and not exists(select 1 from outreach_log where lead_id=item.lead_id and direction='inbound');
      next_status := 'Email ' || touch || ' Sent';
      update leads set email_sent_count=greatest(coalesce(email_sent_count,0),touch), updated_at=now() where id=item.lead_id;
      update follow_up_tasks set status='completed',completed_at=now()
        where lead_id=item.lead_id and task_type='send_' || item.message_type and status='pending';
      if safe_progress then
        update leads set status=next_status,next_follow_up_at=case when touch<3 then item.accepted_at+interval '3 days' else null end where id=item.lead_id;
        if touch < 3 and not exists(select 1 from follow_up_tasks where lead_id=item.lead_id and task_type='send_email_' || (touch+1) and status='pending') then
          insert into follow_up_tasks(lead_id,outreach_log_id,task_type,due_at,status)
            values(item.lead_id,item.id,'send_email_' || (touch+1),item.accepted_at+interval '3 days','pending');
        end if;
      end if;
    elsif item.message_type='booking_link' then
      next_status := 'Booking Link Sent';
      safe_progress := safe_progress and not coalesce(prospect.meeting_booked,false)
        and prospect.status not in ('Booked','Onboarding Sent','Onboarding Completed');
      update leads set calendly_link_sent=true,updated_at=now() where id=item.lead_id;
      if safe_progress then update leads set status=next_status where id=item.lead_id; end if;
    end if;
    if safe_progress and next_status is not null and prospect.status is distinct from next_status then
      insert into status_audit_log(lead_id,changed_by,field_changed,old_status,new_status,reason)
        values(item.lead_id,item.source,'status',prospect.status,next_status,'Saved email delivery and follow-up transaction');
    end if;
  end if;
  update email_outbox set finalized_at=now() where id=p_id;
end $$;
revoke all on function finalize_email_outbox(uuid) from public, anon, authenticated;
grant execute on function finalize_email_outbox(uuid) to service_role;

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
    new_state := case when points>50 then 'Ready for Outreach' else 'Scored' end;
    update leads set status=new_state,updated_at=now() where id=p_lead_id;
    if old_state<>new_state then
      insert into status_audit_log(lead_id,changed_by,field_changed,old_status,new_status,reason)
      values(p_lead_id,'automation','status',old_state,new_state,'Score and lead status saved together');
    end if;
  end if;
end $$;
revoke all on function save_automation_score(uuid,jsonb) from public, anon, authenticated;
grant execute on function save_automation_score(uuid,jsonb) to service_role;
