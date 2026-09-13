-- The insurance workspace becomes a pipeline.
--
-- 018 gave it search, a saved record and a draft. Everything after "save" was a
-- human with a notepad: no scheduled discovery, no scoring, no contact
-- enrichment, no sequence, no reply handling, and no record of what happened
-- when. This migration adds the state those stages need, and — deliberately —
-- routes insurance sending through the SAME email_outbox the HVAC side uses, so
-- one daily budget, one idempotency guarantee and one transaction protect both.
--
-- Insurance outreach stays OFF until insurance_settings.enabled is set true.
begin;

-- ── Prospect state ─────────────────────────────────────────────────────────
alter table public.insurance_prospects
  add column if not exists company text not null default '',
  add column if not exists title text not null default '',
  add column if not exists city text not null default '',
  add column if not exists website text not null default '',
  -- Qualification. score is a model judgment about fit, never about a person's
  -- licensing status, and score_reason is what it claimed and why.
  add column if not exists score integer check (score is null or (score >= 0 and score <= 100)),
  add column if not exists score_reason text not null default '',
  add column if not exists score_confidence text not null default '',
  add column if not exists scored_at timestamptz,
  add column if not exists enriched_at timestamptz,
  -- Outreach state. Mirrors the leads table so the same reasoning applies.
  add column if not exists email_sent_count integer not null default 0,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists opt_out boolean not null default false,
  add column if not exists bounced boolean not null default false,
  add column if not exists complained boolean not null default false,
  add column if not exists suppression_reason text not null default '',
  add column if not exists suppressed_at timestamptz,
  add column if not exists discovered_by text not null default 'manual';

create index if not exists insurance_prospects_stage on public.insurance_prospects(track, stage);
create index if not exists insurance_prospects_sendable on public.insurance_prospects(stage, email_sent_count)
  where opt_out = false and bounced = false;

-- ── What happened, and when ────────────────────────────────────────────────
-- Append-only. A stage change with no record of why is how a pipeline becomes
-- a guess about its own history.
create table if not exists public.insurance_activities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.insurance_prospects(id) on delete cascade,
  kind text not null check (kind in ('discovered','enriched','scored','stage','note','email_sent','reply','task','suppressed','error')),
  summary text not null,
  detail jsonb not null default '{}',
  actor text not null default 'automation',
  created_at timestamptz not null default now()
);
create index if not exists insurance_activities_prospect on public.insurance_activities(prospect_id, created_at desc);

-- ── Work that is due ───────────────────────────────────────────────────────
create table if not exists public.insurance_tasks (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.insurance_prospects(id) on delete cascade,
  task_type text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','completed','skipped','cancelled')),
  notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists insurance_tasks_due on public.insurance_tasks(status, due_at);

-- ── The switch, and what to hunt ───────────────────────────────────────────
create table if not exists public.insurance_settings (
  id text primary key check (id = 'owner'),
  -- Off by default. Turning this on starts scheduled discovery.
  enabled boolean not null default false,
  -- Separate switch: discovery and scoring may run for weeks before a single
  -- message is allowed out. Sending is the irreversible half.
  sending_enabled boolean not null default false,
  -- Acting on a classified reply without a human reading it first.
  autopilot boolean not null default false,
  tracks text[] not null default array['recruiting','buyers'],
  states text[] not null default array['AZ','SC','VA','OH','MI'],
  queries jsonb not null default '[]',
  cursor integer not null default 0,
  daily_send_cap integer not null default 10 check (daily_send_cap between 1 and 100),
  sequence_gap_days integer not null default 4 check (sequence_gap_days between 1 and 30),
  min_score integer not null default 40 check (min_score between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.insurance_settings(id) values ('owner') on conflict do nothing;

alter table public.insurance_activities enable row level security;
alter table public.insurance_tasks enable row level security;
alter table public.insurance_settings enable row level security;
revoke all on public.insurance_activities, public.insurance_tasks, public.insurance_settings from anon, authenticated;
grant all on public.insurance_activities, public.insurance_tasks, public.insurance_settings to service_role;

-- ── One outbox for both pipelines ──────────────────────────────────────────
alter table public.email_outbox
  add column if not exists insurance_prospect_id uuid references public.insurance_prospects(id) on delete restrict;

-- Rotate track x state so discovery covers the territory instead of re-reading
-- the loudest one. Same shape as next_discovery_target.
create or replace function public.next_insurance_target() returns jsonb
language plpgsql set search_path = public as $$
declare settings insurance_settings; chosen_track text; chosen_state text;
begin
  select * into settings from insurance_settings where id='owner' for update;
  if not found then raise exception 'Insurance settings are missing'; end if;
  if cardinality(settings.tracks)=0 or cardinality(settings.states)=0 then
    raise exception 'Insurance targeting has no track or state saved';
  end if;
  chosen_track := settings.tracks[1 + settings.cursor % cardinality(settings.tracks)];
  chosen_state := settings.states[1 + ((settings.cursor / cardinality(settings.tracks)) % cardinality(settings.states))];
  update insurance_settings set cursor=cursor+1, updated_at=now() where id='owner';
  return jsonb_build_object('track', chosen_track, 'state', chosen_state, 'cursor', settings.cursor);
end $$;
revoke all on function public.next_insurance_target() from public, anon, authenticated;
grant execute on function public.next_insurance_target() to service_role;

-- Score and the stage it implies commit together, and the activity trail
-- records it. Mirrors save_automation_score on the HVAC side.
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
  if record.stage='Research' then
    next_stage := case when points >= (select min_score from insurance_settings where id='owner') then 'Qualified' else 'Research' end;
    if next_stage <> record.stage then
      update insurance_prospects set stage=next_stage where id=p_id;
      insert into insurance_activities(prospect_id,kind,summary,detail)
        values(p_id,'stage','Qualified by score '||points, jsonb_build_object('from',record.stage,'to',next_stage,'score',points));
    end if;
  end if;
  insert into insurance_activities(prospect_id,kind,summary,detail)
    values(p_id,'scored','Scored '||points||' ('||coalesce(p_score->>'confidence','medium')||' confidence)', p_score);
end $$;
revoke all on function public.save_insurance_score(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_insurance_score(uuid,jsonb) to service_role;

-- ── The daily budget now counts BOTH pipelines ─────────────────────────────
-- Reputation belongs to the sending domain, not to a pipeline. An insurance
-- send and an HVAC send damage the same domain, so they draw on one budget.
-- Without this change an insurance send would have had no cap at all: the
-- original reservation only counted rows where lead_id is not null.
create or replace function public.claim_email_outbox(p_id uuid) returns setof email_outbox
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
  if (item.lead_id is not null or item.insurance_prospect_id is not null) and item.first_attempt_at is null then
    select count(*) into used from outreach_log l where direction='outbound' and channel='email' and sent_at >= day_start
      and not exists (select 1 from email_outbox o where o.provider_message_id=l.provider_message_id);
    used := used + (select count(*) from email_outbox
      where (lead_id is not null or insurance_prospect_id is not null) and last_attempt_at >= day_start);
    if used >= item.send_limit then return; end if;
  end if;
  return query update email_outbox set status='sending', attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,now()), last_attempt_at=now(), error_message=null
    where id=p_id returning *;
end $$;
revoke all on function public.claim_email_outbox(uuid) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(uuid) to service_role;

-- ── Finalization understands an insurance send ─────────────────────────────
-- The HVAC branch is untouched. The insurance branch gets the same guarantee:
-- the activity record, the sequence counter, the stage and the next task commit
-- with the send or not at all.
create or replace function public.finalize_email_outbox(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare item email_outbox; prospect leads; touch integer; next_status text; safe_progress boolean;
        person insurance_prospects; gap integer;
begin
  select * into item from email_outbox where id=p_id for update;
  if not found or item.status <> 'sent' then raise exception 'Email has not been accepted'; end if;
  if item.finalized_at is not null then return; end if;

  if item.insurance_prospect_id is not null then
    select * into person from insurance_prospects where id=item.insurance_prospect_id for update;
    if not found then raise exception 'Insurance prospect is missing'; end if;
    touch := coalesce(nullif(regexp_replace(item.message_type, '\D', '', 'g'), '')::integer, 1);
    select sequence_gap_days into gap from insurance_settings where id='owner';

    insert into insurance_activities(prospect_id,kind,summary,detail)
      values(item.insurance_prospect_id,'email_sent','Touch '||touch||' sent to '||item.recipient,
             jsonb_build_object('subject',item.subject,'message_type',item.message_type,'provider_message_id',item.provider_message_id));

    update insurance_prospects set
      email_sent_count=greatest(email_sent_count, touch),
      last_contacted_at=item.accepted_at,
      updated_at=now()
    where id=item.insurance_prospect_id;

    -- Never advance a record a person has already answered or closed.
    if person.stage in ('Research','Qualified','Contacted') and person.replied_at is null
       and not person.opt_out and not person.bounced and not person.complained then
      if person.stage <> 'Contacted' then
        update insurance_prospects set stage='Contacted' where id=item.insurance_prospect_id;
        insert into insurance_activities(prospect_id,kind,summary,detail)
          values(item.insurance_prospect_id,'stage','Moved to Contacted', jsonb_build_object('from',person.stage,'to','Contacted'));
      end if;
      update insurance_tasks set status='completed', completed_at=now()
        where prospect_id=item.insurance_prospect_id and task_type='send_touch_'||touch and status='pending';
      if touch < 3 then
        insert into insurance_tasks(prospect_id,task_type,due_at,status)
        select item.insurance_prospect_id,'send_touch_'||(touch+1), item.accepted_at + (coalesce(gap,4) || ' days')::interval,'pending'
        where not exists (select 1 from insurance_tasks
          where prospect_id=item.insurance_prospect_id and task_type='send_touch_'||(touch+1) and status='pending');
      end if;
    end if;

    update email_outbox set finalized_at=now() where id=p_id;
    return;
  end if;

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
revoke all on function public.finalize_email_outbox(uuid) from public, anon, authenticated;
grant execute on function public.finalize_email_outbox(uuid) to service_role;

commit;
