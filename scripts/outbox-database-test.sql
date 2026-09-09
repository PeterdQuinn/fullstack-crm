-- Execute with migration 016 inside BEGIN ... ROLLBACK. No email provider calls.
do $$
declare prospect uuid; message uuid; followup uuid; claimed integer; records integer;
begin
  insert into leads(business_name,email,status,opt_out,bounced,complained,email_sent_count)
    values('Outbox transaction test','outbox-test@example.invalid','Ready for Outreach',false,false,false,0) returning id into prospect;
  perform save_automation_score(prospect, '{"provider":"test","lead_score":70,"confidence_level":"high"}');
  if not exists(select 1 from lead_ai_summaries where lead_id=prospect and lead_score=70) then raise exception 'Score was not saved'; end if;
  begin
    perform save_automation_score(prospect, '{"provider":"test","lead_score":90,"confidence_level":"invalid"}');
    raise exception 'Invalid score write unexpectedly succeeded';
  exception when check_violation then null;
  end;
  if not exists(select 1 from lead_ai_summaries where lead_id=prospect and lead_score=70) then raise exception 'Failed score write changed saved data'; end if;
  insert into email_outbox(idempotency_key,lead_id,message_type,recipient,sender,reply_to,subject,html,body_text,send_limit)
    values('transaction-test-'||prospect,prospect,'email_1','outbox-test@example.invalid','test@example.invalid','test@example.invalid','test','<p>test</p>','test',100000) returning id into message;
  select count(*) into claimed from claim_email_outbox(message);
  if claimed<>1 then raise exception 'First reservation failed'; end if;
  select count(*) into claimed from claim_email_outbox(message);
  if claimed<>0 then raise exception 'Concurrent reservation was not blocked'; end if;
  update email_outbox set status='sent',provider_message_id='test-'||message,accepted_at=now() where id=message;
  perform finalize_email_outbox(message);
  perform finalize_email_outbox(message);
  select count(*) into records from outreach_log where id=message;
  if records<>1 then raise exception 'Expected one persisted outreach record'; end if;
  select count(*) into records from follow_up_tasks where lead_id=prospect and task_type='send_email_2' and status='pending';
  if records<>1 then raise exception 'Expected exactly one follow-up after replay'; end if;
  if not exists(select 1 from leads where id=prospect and email_sent_count=1 and status='Email 1 Sent') then raise exception 'Lead progress was not saved'; end if;
  if not exists(select 1 from status_audit_log where lead_id=prospect and new_status='Email 1 Sent') then raise exception 'Audit was not saved'; end if;
  insert into email_outbox(idempotency_key,lead_id,message_type,recipient,sender,reply_to,subject,html,body_text,status,provider_message_id,accepted_at)
    values('transaction-followup-'||prospect,prospect,'email_2','outbox-test@example.invalid','test@example.invalid','test@example.invalid','test','test','test','sent','test-followup-'||prospect,now()) returning id into followup;
  update leads set status='Do Not Contact',opt_out=true where id=prospect;
  perform finalize_email_outbox(followup);
  if not exists(select 1 from leads where id=prospect and status='Do Not Contact' and opt_out) then raise exception 'Recovery overwrote suppression'; end if;
  if exists(select 1 from follow_up_tasks where lead_id=prospect and task_type='send_email_3') then raise exception 'Recovery scheduled contact after suppression'; end if;
  update email_outbox set status='sending',first_attempt_at=now()-interval '25 hours',last_attempt_at=now()-interval '24 hours',finalized_at=null where id=message;
  select count(*) into claimed from claim_email_outbox(message);
  if claimed<>0 or not exists(select 1 from email_outbox where id=message and status='needs_review') then raise exception 'Old ambiguous send was retried'; end if;
end $$;
select 'PASS: reservation, replay, saved log/status/audit/followup, suppression, expired retry' as result;
