-- Strengthen FKs and indexes for audit artifacts
-- Created: 2025-08-14

create extension if not exists pgcrypto;

-- Repair: ensure any referenced business_id exists in businesses before adding FKs
-- Idempotent: ON CONFLICT DO NOTHING
with missing as (
  select distinct ar.business_id as id
  from public.audit_runs ar
  left join public.businesses b on b.id = ar.business_id
  where ar.business_id is not null and b.id is null
  union
  select distinct s.business_id as id
  from public.business_snapshots s
  left join public.businesses b on b.id = s.business_id
  where s.business_id is not null and b.id is null
  union
  select distinct n.business_id as id
  from public.nap_observations n
  left join public.businesses b on b.id = n.business_id
  where n.business_id is not null and b.id is null
)
insert into public.businesses (id, slug, name, is_public)
select id, 'migrated-' || id::text, 'Migrated Business', true
from missing
on conflict (id) do nothing;

-- audit_runs.business_id → businesses(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_runs_business_id_fkey'
  ) THEN
    ALTER TABLE public.audit_runs
      ADD CONSTRAINT audit_runs_business_id_fkey
      FOREIGN KEY (business_id)
      REFERENCES public.businesses(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- business_snapshots.business_id → businesses(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_snapshots_business_id_fkey'
  ) THEN
    ALTER TABLE public.business_snapshots
      ADD CONSTRAINT business_snapshots_business_id_fkey
      FOREIGN KEY (business_id)
      REFERENCES public.businesses(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- nap_observations.business_id → businesses(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nap_observations_business_id_fkey'
  ) THEN
    ALTER TABLE public.nap_observations
      ADD CONSTRAINT nap_observations_business_id_fkey
      FOREIGN KEY (business_id)
      REFERENCES public.businesses(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- listing_opportunities.audit_id → audit_runs(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listing_opportunities_audit_id_fkey'
  ) THEN
    ALTER TABLE public.listing_opportunities
      ADD CONSTRAINT listing_opportunities_audit_id_fkey
      FOREIGN KEY (audit_id)
      REFERENCES public.audit_runs(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Helpful indexes (lightweight, idempotent)
create index if not exists idx_snapshots_business on public.business_snapshots(business_id);
create index if not exists idx_nap_obs_business on public.nap_observations(business_id);
-- Others already exist from 2025-08-13_audit_tables.sql: idx_audit_runs_business, idx_list_ops_audit
