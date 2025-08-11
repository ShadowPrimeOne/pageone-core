-- Add account_status enum and status column to profiles
-- Run this in Supabase SQL editor

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'account_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.account_status AS ENUM ('pending', 'approved', 'denied');
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status public.account_status NOT NULL DEFAULT 'pending';

-- Initialize existing rows to approved (adjust if you prefer pending)
UPDATE public.profiles SET status = 'approved' WHERE status IS NULL;

-- Optional: basic index for filtering
CREATE INDEX IF NOT EXISTS profiles_status_idx ON public.profiles (status);
