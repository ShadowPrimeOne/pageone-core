-- Audit flow tables
-- Created: 2025-08-13

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

create table if not exists business_profiles (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid null,
  place_cid text null,
  golden_name text null,
  golden_address text null,
  golden_phone text null,
  website text null,
  socials jsonb null,
  categories text[] null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists audit_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  status text not null check (status in ('pending','running','complete','failed')) default 'pending',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  summary jsonb null
);

create table if not exists business_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  audit_id uuid null,
  source text not null check (source in ('places','website','manual')),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists nap_observations (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null,
  business_id uuid not null,
  source_url text not null,
  source_type text not null check (source_type in ('social','directory','web','places')),
  name text null,
  address text null,
  phone text null,
  match_score int not null default 0,
  mismatch jsonb null,
  captured_at timestamptz not null default now()
);

create table if not exists listing_opportunities (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null,
  directory text not null,
  suggested_url text null,
  reason text null,
  priority int not null default 5
);

create table if not exists ads_audit (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null,
  queries jsonb null,
  ad_counts jsonb null,
  advertisers jsonb null,
  detected_tags jsonb null
);

create table if not exists lighthouse_runs (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null,
  url text not null,
  categories jsonb not null,
  audits jsonb null,
  score float null,
  created_at timestamptz not null default now()
);

-- Optional: basic indexes
create index if not exists idx_audit_runs_business on audit_runs(business_id);
create index if not exists idx_snapshots_audit on business_snapshots(audit_id);
create index if not exists idx_nap_obs_audit on nap_observations(audit_id);
create index if not exists idx_list_ops_audit on listing_opportunities(audit_id);
create index if not exists idx_ads_audit_audit on ads_audit(audit_id);
create index if not exists idx_lh_runs_audit on lighthouse_runs(audit_id);
