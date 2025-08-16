-- Enable RLS and policies for business_profiles mirroring businesses access model
-- Created: 2025-08-14

create extension if not exists pgcrypto;

-- Ensure table exists (from 2025-08-13_audit_tables.sql)
-- Enable RLS
alter table if exists public.business_profiles enable row level security;

-- Policies
-- Dev full access
drop policy if exists "business_profiles dev full" on public.business_profiles;
create policy "business_profiles dev full" on public.business_profiles
for all to authenticated
using (public.is_dev(auth.uid()))
with check (public.is_dev(auth.uid()));

-- Owner or member read via joined business
drop policy if exists "business_profiles owner or member read" on public.business_profiles;
create policy "business_profiles owner or member read" on public.business_profiles
for select to authenticated
using (
  exists (
    select 1 from public.businesses b
    where b.id = business_profiles.business_id
      and (
        b.owner_id = auth.uid()
        or exists (
          select 1 from public.memberships m
          where m.business_id = b.id and m.user_id = auth.uid()
        )
        or b.is_public = true
      )
  )
);

-- Owner update via joined business
drop policy if exists "business_profiles owner update" on public.business_profiles;
create policy "business_profiles owner update" on public.business_profiles
for update to authenticated
using (
  exists (
    select 1 from public.businesses b
    where b.id = business_profiles.business_id and b.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.businesses b
    where b.id = business_profiles.business_id and b.owner_id = auth.uid()
  )
);
