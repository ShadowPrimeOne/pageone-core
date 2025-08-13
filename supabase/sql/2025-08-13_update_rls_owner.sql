-- Update RLS to use role-agnostic owner_id for leads and businesses
-- Run in Supabase SQL editor or via CLI

create extension if not exists pgcrypto;

-- Leads: policies -> owner-based
drop policy if exists "leads dev full" on public.leads;
create policy "leads dev full" on public.leads
for all to authenticated
using (public.is_dev(auth.uid()))
with check (public.is_dev(auth.uid()));

drop policy if exists "leads ambassador own" on public.leads;
create policy "leads owner own" on public.leads
for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Lead audits
drop policy if exists "lead_audits dev full" on public.lead_audits;
create policy "lead_audits dev full" on public.lead_audits
for all to authenticated
using (public.is_dev(auth.uid()))
with check (public.is_dev(auth.uid()));

drop policy if exists "lead_audits ambassador" on public.lead_audits;
create policy "lead_audits owner" on public.lead_audits
for all to authenticated
using (exists (
  select 1 from public.leads l where l.id = lead_audits.lead_id and l.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.leads l where l.id = lead_audits.lead_id and l.owner_id = auth.uid()
));

-- Agreements
drop policy if exists "agreements dev full" on public.agreements;
create policy "agreements dev full" on public.agreements
for all to authenticated
using (public.is_dev(auth.uid()))
with check (public.is_dev(auth.uid()));

drop policy if exists "agreements ambassador" on public.agreements;
create policy "agreements owner" on public.agreements
for all to authenticated
using (exists (
  select 1 from public.leads l where l.id = agreements.lead_id and l.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.leads l where l.id = agreements.lead_id and l.owner_id = auth.uid()
));

-- Payments
drop policy if exists "payments dev full" on public.payments;
create policy "payments dev full" on public.payments
for all to authenticated
using (public.is_dev(auth.uid()))
with check (public.is_dev(auth.uid()));

drop policy if exists "payments ambassador" on public.payments;
create policy "payments owner" on public.payments
for all to authenticated
using (exists (
  select 1 from public.leads l where l.id = payments.lead_id and l.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.leads l where l.id = payments.lead_id and l.owner_id = auth.uid()
));

-- Onboarding tasks (via lead ownership)
drop policy if exists "onboarding_tasks dev full" on public.onboarding_tasks;
create policy "onboarding_tasks dev full" on public.onboarding_tasks
for all to authenticated
using (public.is_dev(auth.uid()))
with check (public.is_dev(auth.uid()));

drop policy if exists "onboarding_tasks ambassador via lead" on public.onboarding_tasks;
create policy "onboarding_tasks owner via lead" on public.onboarding_tasks
for all to authenticated
using (
  lead_id is not null and exists (
    select 1 from public.leads l where l.id = onboarding_tasks.lead_id and l.owner_id = auth.uid()
  )
)
with check (
  lead_id is not null and exists (
    select 1 from public.leads l where l.id = onboarding_tasks.lead_id and l.owner_id = auth.uid()
  )
);

-- Events (owner for lead subjects)
drop policy if exists "events dev full" on public.events;
create policy "events dev full" on public.events
for all to authenticated
using (public.is_dev(auth.uid()))
with check (public.is_dev(auth.uid()));

drop policy if exists "events ambassador leads" on public.events;
create policy "events owner leads" on public.events
for all to authenticated
using (subject_type = 'lead' and exists (
  select 1 from public.leads l where l.id = events.subject_id and l.owner_id = auth.uid()
))
with check (subject_type = 'lead' and exists (
  select 1 from public.leads l where l.id = events.subject_id and l.owner_id = auth.uid()
));

-- Businesses: tighten policies to owner-or-member reads and dev full access
-- Keep existing public read when is_public for anon/auth
-- Replace broad staff write with dev full + owner update

drop policy if exists "staff write" on public.businesses;

drop policy if exists "public read when is_public" on public.businesses;
create policy "public read when is_public" on public.businesses
for select
using (is_public = true);

create policy "businesses dev full" on public.businesses
for all to authenticated
using (public.is_dev(auth.uid()))
with check (public.is_dev(auth.uid()));

create policy "businesses owner or member read" on public.businesses
for select to authenticated
using (
  owner_id = auth.uid() or exists (
    select 1 from public.memberships m where m.business_id = businesses.id and m.user_id = auth.uid()
  ) or is_public = true
);

create policy "businesses owner update" on public.businesses
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());
