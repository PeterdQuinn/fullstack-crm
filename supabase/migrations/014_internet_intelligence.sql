-- Dated observations are append-only so growth is measured, not guessed from a single scrape.
create table if not exists lead_internet_observations (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  category text not null check (category in ('reputation','hiring','expansion','advertising','technology','licensing','bbb','public_records','social','news','website')),
  signal text not null,
  value text not null,
  numeric_value numeric,
  source_label text not null,
  source_url text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  growth_direction smallint not null default 0 check (growth_direction in (-1,0,1)),
  identity_score integer check (identity_score between 0 and 100),
  match_reasons jsonb not null default '[]'::jsonb,
  evidence_type text not null default 'single_source' check (evidence_type in ('verified','single_source')),
  published_at timestamptz,
  corroboration_count integer not null default 1 check (corroboration_count >= 1),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_internet_observations_lead_time on lead_internet_observations(lead_id, observed_at desc);
alter table lead_internet_observations enable row level security;

create table if not exists lead_internet_intelligence (
  lead_id uuid primary key references leads(id) on delete cascade,
  footprint_score integer not null check (footprint_score between 0 and 100),
  momentum_score integer not null check (momentum_score between -100 and 100),
  momentum_label text not null check (momentum_label in ('contracting','quiet','established','growing','scaling')),
  summary text not null,
  provider text not null,
  credits_used integer not null default 0,
  researched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table lead_internet_intelligence enable row level security;
drop trigger if exists lead_internet_intelligence_updated_at on lead_internet_intelligence;
create trigger lead_internet_intelligence_updated_at before update on lead_internet_intelligence for each row execute function update_updated_at();
