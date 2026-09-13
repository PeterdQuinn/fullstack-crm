-- Two records, one person.
--
-- The same agency reached the board twice under two URLs, both carrying
-- june@junelifeinsurance.com. Deduplication on the source URL cannot see that;
-- only the contact details can, and those only exist after enrichment has run.
--
-- A duplicate is LINKED, not deleted. It keeps whatever the pipeline recorded
-- about how it was found, and a merge made by a rule can be undone by a human
-- who disagrees with it — which matters, because the rule is refusing to merge
-- several pairs that a person might merge by eye.
begin;

alter table public.insurance_prospects
  add column if not exists duplicate_of uuid references public.insurance_prospects(id) on delete set null,
  add column if not exists duplicate_reason text not null default '';

-- Every working query filters on this, so it earns an index.
create index if not exists insurance_prospects_active on public.insurance_prospects(track, stage)
  where duplicate_of is null;

-- A duplicate must never be mailed: it is the same inbox as the record it
-- points at, and the sequence state lives on that one.
create or replace function public.claim_email_outbox(p_id uuid) returns setof email_outbox
language plpgsql set search_path = public as $$
declare item email_outbox; used integer; day_start timestamptz; merged uuid;
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
  if item.insurance_prospect_id is not null then
    select duplicate_of into merged from insurance_prospects where id = item.insurance_prospect_id;
    if merged is not null then
      update email_outbox set status='cancelled', error_message='Recipient was merged into another record' where id=p_id;
      return;
    end if;
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

commit;
