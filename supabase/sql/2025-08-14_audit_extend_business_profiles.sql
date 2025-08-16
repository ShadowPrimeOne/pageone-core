-- Extend business_profiles with richer Google Maps/Places fields
-- Created: 2025-08-14

alter table if exists business_profiles
  add column if not exists primary_category text null,
  add column if not exists rating float null,
  add column if not exists rating_count int null,
  add column if not exists latitude double precision null,
  add column if not exists longitude double precision null,
  add column if not exists google_place_id text null,
  add column if not exists google_fid text null,
  add column if not exists google_thumbnail_url text null,
  add column if not exists opening_hours jsonb null,
  add column if not exists google_maps_url text null;

-- Optional indexes (lightweight)
create index if not exists idx_business_profiles_cid on business_profiles(place_cid);
create index if not exists idx_business_profiles_place_id on business_profiles(google_place_id);
