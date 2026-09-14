-- Standalone multi-license model. NIPR is optional; public/state evidence is enough.
alter table public.insurance_prospects add column if not exists licenses jsonb not null default '[]';
create index if not exists insurance_prospects_licenses on public.insurance_prospects using gin (licenses);
