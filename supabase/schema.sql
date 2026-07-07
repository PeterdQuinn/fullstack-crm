-- ============================================================
-- Full Stack Services LLC — CRM Database Schema
-- Run this in your Supabase SQL editor (supabase.com > project > SQL Editor)
-- ============================================================

-- LEADS TABLE
create table if not exists leads (
  id uuid default gen_random_uuid() primary key,
  business_name text not null,
  owner_name text,
  contact_name text,
  phone text,
  email text,
  website text,
  address text,
  city text,
  state text,
  postal_code text,
  niche text default 'General',
  industry text,
  employees text,
  annual_revenue text,
  founded_year text,
  short_description text,
  technologies text,
  keywords text,
  linkedin_url text,
  facebook_url text,
  twitter_url text,
  apollo_account_id text,
  current_software text,
  monthly_spend_estimate text,
  status text default 'New' check (status in ('New','Called','No Answer','Follow-Up','Interested','Booked','Dead','Needs Data','Ready for AI Summary','Ready for Outreach','Email 1 Sent','Email 2 Sent','Email 3 Sent','DM Needed','DM Sent','Call Needed','Called','Follow-Up Scheduled','Replied','Interested','Booking Link Sent','Booked','Onboarding Sent','Onboarding Completed','Won','Lost','No Response','Do Not Contact','Bad Data','Bad Email')),
  last_called_at timestamptz,
  next_follow_up_at timestamptz,
  meeting_booked boolean default false,
  meeting_date timestamptz,
  opt_out boolean default false,
  bounced boolean default false,
  complained boolean default false,
  -- Pipeline status captured at the moment the lead was suppressed
  -- (bounced/complained/opt_out), so the Suppressed view can show it.
  status_before_suppression text,
  -- Consent / legal basis for outreach, set when a lead is added via Discovery.
  contact_basis text,
  contact_basis_logged_at timestamptz,
  email_sent_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- CALL LOGS TABLE
create table if not exists call_logs (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references leads(id) on delete cascade,
  called_at timestamptz default now(),
  outcome text check (outcome in ('No answer','Left voicemail','Spoke with gatekeeper','Spoke with owner','Callback requested','Not interested','Interested','Booked meeting')),
  notes text,
  current_software text,
  client_acquisition_method text,
  pain_point text,
  next_follow_up_at timestamptz,
  created_at timestamptz default now()
);

-- LEAD NOTES TABLE
create table if not exists lead_notes (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references leads(id) on delete cascade,
  note text not null,
  created_at timestamptz default now()
);

-- APPOINTMENTS TABLE
create table if not exists appointments (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references leads(id) on delete cascade,
  meeting_date date not null,
  meeting_time time not null,
  google_event_id text,
  notes text,
  created_at timestamptz default now()
);

-- INDEXES
create index if not exists idx_leads_status on leads(status);
create index if not exists idx_leads_niche on leads(niche);
create index if not exists idx_leads_next_follow_up on leads(next_follow_up_at);
create index if not exists idx_call_logs_lead_id on call_logs(lead_id);
create index if not exists idx_lead_notes_lead_id on lead_notes(lead_id);
create index if not exists idx_appointments_lead_id on appointments(lead_id);

-- AUTO-UPDATE updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- ENABLE ROW LEVEL SECURITY (open for internal use)
alter table leads enable row level security;
alter table call_logs enable row level security;
alter table lead_notes enable row level security;
alter table appointments enable row level security;

create policy "Allow all on leads" on leads for all using (true) with check (true);
create policy "Allow all on call_logs" on call_logs for all using (true) with check (true);
create policy "Allow all on lead_notes" on lead_notes for all using (true) with check (true);
create policy "Allow all on appointments" on appointments for all using (true) with check (true);

-- AUTOMATION LAYER TABLES

-- LEAD AI SUMMARIES TABLE
create table if not exists lead_ai_summaries (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  main_pain_point text,
  pain_reason text,
  best_attack_angle text,
  recommended_first_message text,
  recommended_follow_up text,
  lead_score integer,
  confidence_level text check (confidence_level in ('low', 'medium', 'high')),
  missing_data_needed jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(lead_id)
);

-- LEAD SOCIALS TABLE
create table if not exists lead_socials (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  platform text not null,
  url text,
  username text,
  is_active boolean default false,
  last_post_date timestamptz,
  followers_count integer,
  last_checked_at timestamptz,
  created_at timestamptz default now()
);

-- OUTREACH LOG TABLE
create table if not exists outreach_log (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null,
  direction text,
  message_type text,
  subject text,
  message_body text,
  status text,
  provider text,
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz default now()
);

-- FOLLOW UP TASKS TABLE
create table if not exists follow_up_tasks (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  outreach_log_id uuid references outreach_log(id) on delete set null,
  task_type text not null,
  due_at timestamptz not null,
  status text default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- BOOKING TRACKER TABLE
create table if not exists booking_tracker (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  booking_status text,
  booking_link_sent_at timestamptz,
  booked_at timestamptz,
  call_time timestamptz,
  no_show boolean default false,
  onboarding_sent boolean default false,
  onboarding_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(lead_id)
);

-- AUTOMATION INDEXES
create index if not exists idx_lead_ai_summaries_lead_id on lead_ai_summaries(lead_id);
create index if not exists idx_lead_socials_lead_id on lead_socials(lead_id);
create index if not exists idx_outreach_log_lead_id on outreach_log(lead_id);
create index if not exists idx_outreach_log_channel on outreach_log(channel);
create index if not exists idx_follow_up_tasks_lead_id on follow_up_tasks(lead_id);
create index if not exists idx_follow_up_tasks_due_at on follow_up_tasks(due_at);
create index if not exists idx_booking_tracker_lead_id on booking_tracker(lead_id);

-- TRIGGERS FOR AUTOMATION TABLES
create trigger lead_ai_summaries_updated_at
  before update on lead_ai_summaries
  for each row execute function update_updated_at();

create trigger booking_tracker_updated_at
  before update on booking_tracker
  for each row execute function update_updated_at();

-- RLS FOR AUTOMATION TABLES
alter table lead_ai_summaries enable row level security;
alter table lead_socials enable row level security;
alter table outreach_log enable row level security;
alter table follow_up_tasks enable row level security;
alter table booking_tracker enable row level security;

create policy "Allow all on lead_ai_summaries" on lead_ai_summaries for all using (true) with check (true);
create policy "Allow all on lead_socials" on lead_socials for all using (true) with check (true);
create policy "Allow all on outreach_log" on outreach_log for all using (true) with check (true);
create policy "Allow all on follow_up_tasks" on follow_up_tasks for all using (true) with check (true);
create policy "Allow all on booking_tracker" on booking_tracker for all using (true) with check (true);

-- LEAD DISCOVERY CONFIG
create table if not exists lead_discovery_config (
  id uuid default gen_random_uuid() primary key,
  key text unique not null,
  last_state_index integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create policy "Allow all on lead_discovery_config" on lead_discovery_config for all using (true) with check (true);
alter table lead_discovery_config enable row level security;

-- CRON FAILURES TABLE (automation phase failure log)
create table if not exists cron_failures (
  id uuid default gen_random_uuid() primary key,
  phase text not null,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists idx_cron_failures_created_at on cron_failures(created_at);

alter table cron_failures enable row level security;
create policy "Allow all on cron_failures" on cron_failures for all using (true) with check (true);
