-- Store the evidence and certainty behind every Research Center fact.
create table if not exists lead_research_facts (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  field_name text not null,
  label text not null,
  field_value text,
  certainty text not null check (certainty in ('verified', 'single_source', 'ai_inference', 'not_found')),
  source_label text,
  source_url text,
  source_count integer not null default 0,
  researched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lead_id, field_name)
);

create index if not exists idx_lead_research_facts_lead_id on lead_research_facts(lead_id);
alter table lead_research_facts enable row level security;
drop policy if exists "Allow all on lead_research_facts" on public.lead_research_facts;
drop policy if exists "Open access lead_research_facts" on public.lead_research_facts;

drop trigger if exists lead_research_facts_updated_at on lead_research_facts;
create trigger lead_research_facts_updated_at
  before update on lead_research_facts
  for each row execute function update_updated_at();
