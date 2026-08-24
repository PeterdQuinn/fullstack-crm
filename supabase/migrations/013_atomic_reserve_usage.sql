-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic usage reservation.
--
-- lib/tenant.ts reserveUsage() reads the counter, then writes it back. Two
-- concurrent requests both read `used = cap - 1`, both decide there is room, and
-- both write `cap`. The tenant overshoots by roughly the number of in-flight
-- requests.
--
-- Tolerable for discovery (a few extra Google Places calls). NOT tolerable for
-- emails_sent, where the overshoot is real mail against a paid cap and against
-- sender reputation -- the exact failure the DB-backed daily send cap was
-- introduced to prevent.
--
-- The fix is to let Postgres decide the race. A single UPDATE ... WHERE used <
-- cap is atomic: concurrent callers serialise on the row lock and the loser
-- sees zero rows updated, which is the "at cap" answer.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function reserve_usage(
  p_tenant_id uuid,
  p_metric text,
  p_cap integer,
  p_period_key text
) returns boolean
language plpgsql
as $$
declare
  v_reserved boolean := false;
begin
  -- Create the counter if this is the period's first reservation. ON CONFLICT
  -- makes two simultaneous first-calls safe: one inserts, the other falls
  -- through to the UPDATE below.
  insert into tenant_usage (tenant_id, period_key, metric, used, cap)
  values (p_tenant_id, p_period_key, p_metric, 0, p_cap)
  on conflict (tenant_id, period_key, metric) do nothing;

  -- The whole decision in one statement. `used < cap` is evaluated against the
  -- row as locked, so it cannot be stale by the time the write lands.
  update tenant_usage
     set used = used + 1,
         updated_at = now()
   where tenant_id = p_tenant_id
     and period_key = p_period_key
     and metric = p_metric
     and used < cap
  returning true into v_reserved;

  return coalesce(v_reserved, false);
end $$;

-- Giving a unit back when the work did not happen. Floors at zero so a double
-- release can never manufacture quota.
create or replace function release_usage(
  p_tenant_id uuid,
  p_metric text,
  p_period_key text
) returns void
language sql
as $$
  update tenant_usage
     set used = greatest(used - 1, 0),
         updated_at = now()
   where tenant_id = p_tenant_id
     and period_key = p_period_key
     and metric = p_metric;
$$;

-- reserve_usage depends on this to make ON CONFLICT work and to stop a metric
-- being counted twice in one period.
create unique index if not exists idx_tenant_usage_unique
  on tenant_usage (tenant_id, period_key, metric);
