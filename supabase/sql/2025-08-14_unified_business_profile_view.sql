-- Unified view joining businesses + business_profiles for frontend consumption
-- Created: 2025-08-14

-- Idempotent replace
DROP VIEW IF EXISTS public.unified_business_profile_view;
CREATE VIEW public.unified_business_profile_view AS
SELECT
  b.id                         AS business_id,
  b.slug                       AS slug,
  b.name                       AS business_name,
  b.owner_id                   AS owner_id,
  b.is_public                  AS is_public,
  b.golden_profile             AS golden_profile,
  b.pipeline_stage             AS pipeline_stage,
  b.membership                 AS membership,
  b.trial_started_at           AS trial_started_at,
  b.trial_ends_at              AS trial_ends_at,
  b.subscribed_at              AS subscribed_at,
  b.unsubscribed_at            AS unsubscribed_at,
  bp.id                        AS profile_id,
  bp.business_id               AS profile_business_id,
  bp.place_cid                 AS place_cid,
  COALESCE(bp.golden_name, b.name) AS normalized_name,
  bp.golden_address            AS address,
  bp.golden_phone              AS phone,
  bp.website                   AS website,
  bp.socials                   AS socials,
  bp.categories                AS categories,
  bp.primary_category          AS primary_category,
  bp.rating                    AS rating,
  bp.rating_count              AS rating_count,
  bp.latitude                  AS latitude,
  bp.longitude                 AS longitude,
  bp.google_place_id           AS google_place_id,
  bp.google_fid                AS google_fid,
  bp.google_thumbnail_url      AS google_thumbnail_url,
  bp.opening_hours             AS opening_hours,
  bp.google_maps_url           AS google_maps_url,
  bp.created_at                AS profile_created_at
FROM public.businesses b
LEFT JOIN public.business_profiles bp ON bp.business_id = b.id;

-- Note: RLS applies per underlying tables; ensure frontend selects via this view where possible.
