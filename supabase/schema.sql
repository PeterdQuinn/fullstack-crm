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
  status text default 'New' check (status in ('New','Called','No Answer','Follow-Up','Interested','Booked','Dead')),
  last_called_at timestamptz,
  next_follow_up_at timestamptz,
  meeting_booked boolean default false,
  meeting_date timestamptz,
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
