-- ProducerForge-only insurance state. This migration deliberately has no
-- references to the Full Stack Services leads, outbox, or automation tables.
begin;
alter table public.insurance_prospects
  add column if not exists company text not null default '', add column if not exists title text not null default '',
  add column if not exists city text not null default '', add column if not exists website text not null default '',
  add column if not exists score integer, add column if not exists score_reason text not null default '',
  add column if not exists score_confidence text not null default '', add column if not exists scored_at timestamptz,
  add column if not exists enriched_at timestamptz, add column if not exists email_sent_count integer not null default 0,
  add column if not exists last_contacted_at timestamptz, add column if not exists replied_at timestamptz,
  add column if not exists opt_out boolean not null default false, add column if not exists bounced boolean not null default false,
  add column if not exists complained boolean not null default false, add column if not exists suppression_reason text not null default '',
  add column if not exists suppressed_at timestamptz, add column if not exists discovered_by text not null default 'manual',
  add column if not exists duplicate_of uuid references public.insurance_prospects(id), add column if not exists fit_assessment jsonb;
create table if not exists public.insurance_activities (id uuid primary key default gen_random_uuid(), prospect_id uuid references public.insurance_prospects(id) on delete cascade, kind text not null, summary text not null, detail jsonb not null default '{}', actor text not null default 'automation', created_at timestamptz not null default now());
create table if not exists public.insurance_tasks (id uuid primary key default gen_random_uuid(), prospect_id uuid references public.insurance_prospects(id) on delete cascade, task_type text not null, due_at timestamptz not null, status text not null default 'pending', notes text not null default '', completed_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.insurance_settings (id text primary key, enabled boolean not null default false, sending_enabled boolean not null default false, autopilot boolean not null default false, tracks text[] not null default array['recruiting','buyers'], states text[] not null default array['AZ','SC','VA','OH','MI'], queries jsonb not null default '[]', daily_send_cap integer not null default 10, sequence_gap_days integer not null default 4, min_score integer not null default 40, recruiting_languages jsonb not null default '{"enabled":true,"preferred_languages":[]}', targeting jsonb not null default '{}', updated_at timestamptz not null default now());
insert into public.insurance_settings(id) values ('owner') on conflict do nothing;
create table if not exists public.insurance_email_outbox (id uuid primary key default gen_random_uuid(), idempotency_key text unique not null, insurance_prospect_id uuid references public.insurance_prospects(id), message_type text not null, recipient text not null, sender text not null, reply_to text, subject text not null, html text not null, body_text text not null, source text not null default 'owner', status text not null default 'queued', attempts integer not null default 0, provider_message_id text, error_message text, created_at timestamptz not null default now(), last_attempt_at timestamptz, finalized_at timestamptz);
commit;
