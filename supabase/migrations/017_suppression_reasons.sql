-- Why a lead is suppressed, not just that it is.
--
-- Before this, a bounce wrote `bounced = true` and nothing else. Resend sends
-- the bounce type and diagnostic with every event and all of it was discarded,
-- so a mailbox that was temporarily full and an address that has never existed
-- were recorded identically and both retired the lead permanently. The
-- pre-send mailability check already produces a real reason and a transient
-- flag; that was written to status_audit_log and never read back.
--
-- suppression_kind is what the operator can act on:
--   permanent  the person asked to stop. No channel, ever.
--   address    the address is wrong. Find another one, or call them.
--   transient  it failed this time. Worth retrying.

alter table leads add column if not exists suppression_reason text;
alter table leads add column if not exists suppression_kind text
  check (suppression_kind is null or suppression_kind in ('permanent', 'address', 'transient'));
alter table leads add column if not exists suppressed_at timestamptz;

alter table outreach_log add column if not exists bounce_type text;
alter table outreach_log add column if not exists bounce_reason text;

create index if not exists idx_leads_suppression on leads(suppression_kind) where suppression_kind is not null;

-- Backfill from what was already recorded. The mailability reason lives in the
-- audit log; anything else that bounced is treated as an address problem, which
-- is the safe reading — it routes to "find another address" rather than to
-- "never contact", and never the other way around.
update leads l set
  suppression_reason = coalesce(l.suppression_reason, a.reason),
  suppression_kind = coalesce(l.suppression_kind,
    case
      when l.opt_out or l.complained then 'permanent'
      when a.reason ilike '%temporary%' then 'transient'
      else 'address'
    end),
  suppressed_at = coalesce(l.suppressed_at, a.changed_at, l.updated_at)
from (
  select distinct on (lead_id) lead_id, reason, changed_at
  from status_audit_log
  where new_status in ('Bad Email', 'Do Not Contact')
  order by lead_id, changed_at desc
) a
where a.lead_id = l.id and l.suppression_kind is null;

-- Leads suppressed with no audit row at all still need a kind to be listed.
update leads set
  suppression_kind = case when opt_out or complained then 'permanent' else 'address' end,
  suppressed_at = coalesce(suppressed_at, updated_at)
where suppression_kind is null and (bounced or complained or opt_out or status = 'Bad Email');
