-- Business pipeline fields and enums to support single-profile pipeline
-- Idempotent migration

-- Enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline_stage') THEN
    CREATE TYPE pipeline_stage AS ENUM ('lead','audited','initiated','onboarded','subscribed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status') THEN
    CREATE TYPE membership_status AS ENUM ('trial','subscribed','churned');
  END IF;
END $$;

-- Columns on businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS golden_profile jsonb,
  ADD COLUMN IF NOT EXISTS pipeline_stage pipeline_stage DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS membership membership_status,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS businesses_pipeline_stage_idx ON public.businesses (pipeline_stage);
CREATE INDEX IF NOT EXISTS businesses_membership_idx ON public.businesses (membership);
CREATE INDEX IF NOT EXISTS businesses_owner_idx ON public.businesses (owner_id);

-- Optional: view to derive stage when missing from artifacts (MVP simple passthrough)
CREATE OR REPLACE VIEW public.business_pipeline_view AS
SELECT
  b.*
FROM public.businesses b;

-- RLS note: existing policies in 2025-08-12_init_businesses.sql grant public read when is_public=true, and staff write to dev/ambassador.
-- Future: add owner-scoped read/write for ambassadors only (owner_id = auth.uid()).
