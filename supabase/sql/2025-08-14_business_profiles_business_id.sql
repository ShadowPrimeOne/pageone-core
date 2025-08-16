-- Add business_id to business_profiles and backfill from leads
-- Created: 2025-08-14

create extension if not exists pgcrypto;

-- 1) Add column (nullable first for safe backfill)
alter table if exists public.business_profiles
  add column if not exists business_id uuid;

-- Helpful indexes
create index if not exists idx_business_profiles_business_id on public.business_profiles(business_id);
-- Enforce 1:1 (unique when present; will tighten to NOT NULL after backfill)
create unique index if not exists uq_business_profiles_business on public.business_profiles(business_id) where business_id is not null;

-- 2) Ensure every lead has a business (create lightweight businesses for missing)
-- Use deterministic slug derived from lead id to keep this idempotent
insert into public.businesses (slug, name, is_public)
select 'biz-' || left(l.id::text, 8) as slug,
       coalesce(l.golden_record->>'name', 'Unknown') as name,
       true as is_public
from public.leads l
where l.business_id is null
on conflict (slug) do nothing;

-- 3) Link leads to the created businesses
update public.leads l
set business_id = b.id
from public.businesses b
where l.business_id is null
  and b.slug = 'biz-' || left(l.id::text, 8);

-- 4) Backfill business_profiles.business_id from linked leads
update public.business_profiles bp
set business_id = l.business_id
from public.leads l
where bp.lead_id = l.id
  and bp.business_id is null
  and l.business_id is not null;

-- 5) Add FK (if missing) after backfill
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_profiles_business_id_fkey'
  ) THEN
    ALTER TABLE public.business_profiles
      ADD CONSTRAINT business_profiles_business_id_fkey
      FOREIGN KEY (business_id)
      REFERENCES public.businesses(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- 6) Tighten to NOT NULL only when safe (no NULLs remain)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='business_profiles' AND column_name='business_id'
      AND is_nullable='YES'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM public.business_profiles WHERE business_id IS NULL) THEN
      ALTER TABLE public.business_profiles ALTER COLUMN business_id SET NOT NULL;
    END IF;
  END IF;
END $$;
