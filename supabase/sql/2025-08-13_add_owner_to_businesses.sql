-- Add explicit owner_id to businesses for ambassador/client ownership tracking
-- Run this once in Supabase SQL editor or via CLI

-- Ensure pgcrypto is available (idempotent)
create extension if not exists pgcrypto;

-- Add owner_id column referencing profiles
alter table public.businesses
  add column if not exists owner_id uuid references public.profiles(id);

-- Helpful index for owner lookups
create index if not exists businesses_owner_id_idx on public.businesses(owner_id);

-- Backfill owner_id from linked leads (if any), prefer the most recent lead link
update public.businesses b
set owner_id = l.ambassador_id
from public.leads l
where l.business_id = b.id
  and b.owner_id is null
  and l.ambassador_id is not null;

-- Optional: keep updated_at current
update public.businesses set updated_at = now() where false; -- no-op to keep file idempotent
