-- Add explicit owner_id to leads for role-agnostic ownership (dev or ambassador)
-- Run this once in Supabase SQL editor or via CLI

create extension if not exists pgcrypto;

alter table public.leads
  add column if not exists owner_id uuid references public.profiles(id);

create index if not exists leads_owner_id_idx on public.leads(owner_id);

-- Backfill from ambassador_id where present
update public.leads
set owner_id = ambassador_id
where owner_id is null and ambassador_id is not null;
