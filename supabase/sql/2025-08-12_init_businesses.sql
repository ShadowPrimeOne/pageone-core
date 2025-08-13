-- Initialize businesses table with basic fields and public read RLS for status pages
-- Apply this in Supabase SQL editor or via CLI

-- Optional: ensure pgcrypto exists for gen_random_uuid()
create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text,
  health_score integer check (health_score between 0 and 100),
  updated_at timestamptz not null default now(),
  is_public boolean not null default true
);

-- In case the table pre-existed without these columns, add them idempotently
alter table public.businesses add column if not exists is_public boolean not null default true;
alter table public.businesses add column if not exists updated_at timestamptz not null default now();
alter table public.businesses add column if not exists health_score integer;
-- Some existing schemas include a NOT NULL created_by; allow NULL for seeding/demo
alter table public.businesses add column if not exists created_by uuid;
alter table public.businesses alter column created_by drop not null;

-- Helpful index for lookups by slug (unique already enforces, but explicit index name is handy)
create unique index if not exists businesses_slug_key on public.businesses (slug);

-- Keep updated_at current on change (optional trigger)
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.businesses enable row level security;

-- Public read for status pages (anon + authenticated)
drop policy if exists "public read when is_public" on public.businesses;
create policy "public read when is_public" on public.businesses
for select
using (is_public = true);

-- Staff write access (authenticated users with role dev or ambassador in profiles)
drop policy if exists "staff write" on public.businesses;
create policy "staff write"
on public.businesses
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('dev','ambassador')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('dev','ambassador')
  )
);

-- Seed a demo row for quick verification
insert into public.businesses (slug, name, health_score, is_public)
values ('demo-business', 'Demo Business', 72, true)
on conflict (slug) do update
set name = excluded.name,
    health_score = excluded.health_score,
    is_public = excluded.is_public,
    updated_at = now();
