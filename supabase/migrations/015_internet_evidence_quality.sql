-- Make every internet observation auditable as a matched fact, not a search guess.
alter table lead_internet_observations add column if not exists identity_score integer check (identity_score between 0 and 100);
alter table lead_internet_observations add column if not exists match_reasons jsonb not null default '[]'::jsonb;
alter table lead_internet_observations add column if not exists evidence_type text not null default 'single_source' check (evidence_type in ('verified','single_source'));
alter table lead_internet_observations add column if not exists published_at timestamptz;
alter table lead_internet_observations add column if not exists corroboration_count integer not null default 1 check (corroboration_count >= 1);
create index if not exists idx_internet_observations_quality on lead_internet_observations(lead_id, evidence_type, observed_at desc);
