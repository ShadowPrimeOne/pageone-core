-- Leads & Onboarding schema to support Golden Record → Agreement/Payment → Conversion → Onboarding
-- Idempotent and RLS-ready. Apply in Supabase SQL editor.
-- Ensure pgcrypto exists for gen_random_uuid()
create extension if not exists pgcrypto;

-- Enums (create if missing)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_status') THEN
    CREATE TYPE lead_status AS ENUM ('prospecting','audited','qualified','agreed','paid','onboarded','converted');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onboarding_stage') THEN
    CREATE TYPE onboarding_stage AS ENUM ('health_check','agreement','payment','setup','live');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('todo','in_progress','blocked','done');
  END IF;
END $$;

-- Leads (Golden Record holder)
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  slug text UNIQUE,
  ambassador_id uuid REFERENCES public.profiles(id),
  status lead_status NOT NULL DEFAULT 'prospecting',
  golden_record jsonb NOT NULL,
  source text,
  audit_id uuid,
  agreement_id uuid,
  payment_id uuid,
  business_id uuid REFERENCES public.businesses(id)
);

-- Ensure columns exist if table pre-existed
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ambassador_id uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS status lead_status NOT NULL DEFAULT 'prospecting';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS golden_record jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS audit_id uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS agreement_id uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS payment_id uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS business_id uuid;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS leads_slug_key ON public.leads (slug);
CREATE INDEX IF NOT EXISTS leads_ambassador_status_idx ON public.leads (ambassador_id, status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lead audits
CREATE TABLE IF NOT EXISTS public.lead_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  score integer,
  findings jsonb,
  recommendations jsonb
);
CREATE INDEX IF NOT EXISTS lead_audits_lead_idx ON public.lead_audits (lead_id);

-- Agreements
CREATE TABLE IF NOT EXISTS public.agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  doc_url text,
  signed_at timestamptz
);
CREATE INDEX IF NOT EXISTS agreements_lead_idx ON public.agreements (lead_id);

-- Payments
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  provider text,
  amount_cents int,
  currency text DEFAULT 'AUD',
  status text NOT NULL DEFAULT 'pending',
  session_id text,
  receipt_url text,
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS payments_lead_idx ON public.payments (lead_id);

-- Onboarding tasks (before/after conversion)
CREATE TABLE IF NOT EXISTS public.onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  stage onboarding_stage NOT NULL,
  title text,
  status task_status NOT NULL DEFAULT 'todo',
  payload jsonb
);
CREATE INDEX IF NOT EXISTS onboarding_tasks_lead_idx ON public.onboarding_tasks (lead_id);
CREATE INDEX IF NOT EXISTS onboarding_tasks_business_idx ON public.onboarding_tasks (business_id);
CREATE INDEX IF NOT EXISTS onboarding_tasks_stage_status_idx ON public.onboarding_tasks (stage, status);

-- Client accounts (minimal; dev-only access initially)
CREATE TABLE IF NOT EXISTS public.client_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('gmb','google_ads','meta','microsoft','analytics','search_console')),
  external_id text,
  access_status text DEFAULT 'pending',
  details jsonb
);
CREATE INDEX IF NOT EXISTS client_accounts_business_platform_idx ON public.client_accounts (business_id, platform);

-- Events
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  subject_type text NOT NULL CHECK (subject_type IN ('lead','business')),
  subject_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb
);
CREATE INDEX IF NOT EXISTS events_subject_idx ON public.events (subject_type, subject_id, created_at DESC);

-- RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Helper predicate: user is dev
CREATE OR REPLACE FUNCTION public.is_dev(uid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.role = 'dev'
  )
$$;

-- leads policies
DROP POLICY IF EXISTS "leads dev full" ON public.leads;
CREATE POLICY "leads dev full" ON public.leads
FOR ALL TO authenticated
USING (public.is_dev(auth.uid()))
WITH CHECK (public.is_dev(auth.uid()));

DROP POLICY IF EXISTS "leads ambassador own" ON public.leads;
CREATE POLICY "leads ambassador own" ON public.leads
FOR ALL TO authenticated
USING (ambassador_id = auth.uid())
WITH CHECK (ambassador_id = auth.uid());

-- child tables: dev full OR ambassador owns parent lead
-- lead_audits
DROP POLICY IF EXISTS "lead_audits dev full" ON public.lead_audits;
CREATE POLICY "lead_audits dev full" ON public.lead_audits
FOR ALL TO authenticated
USING (public.is_dev(auth.uid()))
WITH CHECK (public.is_dev(auth.uid()));

DROP POLICY IF EXISTS "lead_audits ambassador" ON public.lead_audits;
CREATE POLICY "lead_audits ambassador" ON public.lead_audits
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = lead_audits.lead_id AND l.ambassador_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = lead_audits.lead_id AND l.ambassador_id = auth.uid()
));

-- agreements
DROP POLICY IF EXISTS "agreements dev full" ON public.agreements;
CREATE POLICY "agreements dev full" ON public.agreements
FOR ALL TO authenticated
USING (public.is_dev(auth.uid()))
WITH CHECK (public.is_dev(auth.uid()));

DROP POLICY IF EXISTS "agreements ambassador" ON public.agreements;
CREATE POLICY "agreements ambassador" ON public.agreements
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = agreements.lead_id AND l.ambassador_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = agreements.lead_id AND l.ambassador_id = auth.uid()
));

-- payments
DROP POLICY IF EXISTS "payments dev full" ON public.payments;
CREATE POLICY "payments dev full" ON public.payments
FOR ALL TO authenticated
USING (public.is_dev(auth.uid()))
WITH CHECK (public.is_dev(auth.uid()));

DROP POLICY IF EXISTS "payments ambassador" ON public.payments;
CREATE POLICY "payments ambassador" ON public.payments
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = payments.lead_id AND l.ambassador_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = payments.lead_id AND l.ambassador_id = auth.uid()
));

-- onboarding_tasks (limited: accessible via lead ownership; post-conversion access via business membership to be added later)
DROP POLICY IF EXISTS "onboarding_tasks dev full" ON public.onboarding_tasks;
CREATE POLICY "onboarding_tasks dev full" ON public.onboarding_tasks
FOR ALL TO authenticated
USING (public.is_dev(auth.uid()))
WITH CHECK (public.is_dev(auth.uid()));

DROP POLICY IF EXISTS "onboarding_tasks ambassador via lead" ON public.onboarding_tasks;
CREATE POLICY "onboarding_tasks ambassador via lead" ON public.onboarding_tasks
FOR ALL TO authenticated
USING (
  lead_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = onboarding_tasks.lead_id AND l.ambassador_id = auth.uid()
  )
)
WITH CHECK (
  lead_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = onboarding_tasks.lead_id AND l.ambassador_id = auth.uid()
  )
);

-- client_accounts (dev only for now to avoid membership dependency)
DROP POLICY IF EXISTS "client_accounts dev full" ON public.client_accounts;
CREATE POLICY "client_accounts dev full" ON public.client_accounts
FOR ALL TO authenticated
USING (public.is_dev(auth.uid()))
WITH CHECK (public.is_dev(auth.uid()));

-- events (dev full; ambassador for their leads only)
DROP POLICY IF EXISTS "events dev full" ON public.events;
CREATE POLICY "events dev full" ON public.events
FOR ALL TO authenticated
USING (public.is_dev(auth.uid()))
WITH CHECK (public.is_dev(auth.uid()));

DROP POLICY IF EXISTS "events ambassador leads" ON public.events;
CREATE POLICY "events ambassador leads" ON public.events
FOR ALL TO authenticated
USING (subject_type = 'lead' AND EXISTS (
  SELECT 1 FROM public.leads l WHERE l.id = events.subject_id AND l.ambassador_id = auth.uid()
))
WITH CHECK (subject_type = 'lead' AND EXISTS (
  SELECT 1 FROM public.leads l WHERE l.id = events.subject_id AND l.ambassador_id = auth.uid()
));

-- Seed a demo lead (optional)
INSERT INTO public.leads (slug, status, source, golden_record)
VALUES (
  'demo-lead',
  'prospecting',
  'manual',
  jsonb_build_object(
    'name','Demo Business',
    'domain','demo.example',
    'phones', jsonb_build_array('+1 555 0100'),
    'emails', jsonb_build_array('info@demo.example'),
    'address', 'N/A',
    'categories', jsonb_build_array('demo'),
    'website', 'https://demo.example'
  )
)
ON CONFLICT (slug) DO NOTHING;
