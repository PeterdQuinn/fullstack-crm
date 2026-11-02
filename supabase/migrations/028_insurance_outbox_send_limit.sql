begin;

alter table public.insurance_email_outbox
  add column if not exists send_limit integer not null default 40;

notify pgrst, 'reload schema';

commit;
