-- The CRM now reads and writes through authenticated server routes.
-- Remove the original public policies so the browser anon key cannot access data.
drop policy if exists "Allow all on leads" on public.leads;
drop policy if exists "Allow all on call_logs" on public.call_logs;
drop policy if exists "Allow all on lead_notes" on public.lead_notes;
drop policy if exists "Allow all on appointments" on public.appointments;
drop policy if exists "Allow all on lead_ai_summaries" on public.lead_ai_summaries;
drop policy if exists "Allow all on lead_socials" on public.lead_socials;
drop policy if exists "Allow all on outreach_log" on public.outreach_log;
drop policy if exists "Allow all on follow_up_tasks" on public.follow_up_tasks;
drop policy if exists "Allow all on booking_tracker" on public.booking_tracker;
drop policy if exists "Allow all on lead_discovery_config" on public.lead_discovery_config;
drop policy if exists "Allow all on cron_failures" on public.cron_failures;
