-- Seed demo leads utility
-- Run in Supabase SQL editor: select public.seed_demo_leads('shadow.prime.one@gmail.com');
-- Creates three demo leads assigned to the profile/user with this email.

create or replace function public.seed_demo_leads(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_user_id uuid;
  v_role text;
BEGIN
  -- Resolve user by email via auth.users -> profiles
  SELECT p.id, p.role
    INTO v_user_id, v_role
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE u.email = target_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for email: %', target_email;
  END IF;

  -- Insert/Upsert three demo leads with valid Golden Records
  -- Shadow Plumbing
  INSERT INTO public.leads (slug, ambassador_id, status, source, golden_record)
  VALUES (
    'shadow-plumbing',
    v_user_id,
    'prospecting',
    'seed',
    jsonb_build_object(
      'name','Shadow Plumbing',
      'industry', null,
      'address','100 Pipe Rd, Sydney NSW',
      'phones', jsonb_build_array('+61 400 111 111'),
      'emails', jsonb_build_array('plumbing@example.com'),
      'website','https://shadowplumbing.example',
      'contact_name','Alex Prime',
      'contact_position','Owner',
      'socials', jsonb_build_object(
        'facebook', null,
        'instagram', null,
        'twitter', null,
        'youtube', null,
        'linkedin', null,
        'tiktok', null
      )
    )
  )
  ON CONFLICT (slug) DO UPDATE SET
    ambassador_id = EXCLUDED.ambassador_id,
    status = EXCLUDED.status,
    source = 'seed',
    golden_record = EXCLUDED.golden_record;

  -- Shadow Bakery
  INSERT INTO public.leads (slug, ambassador_id, status, source, golden_record)
  VALUES (
    'shadow-bakery',
    v_user_id,
    'agreed',
    'seed',
    jsonb_build_object(
      'name','Shadow Bakery',
      'industry', null,
      'address','200 Bread St, Melbourne VIC',
      'phones', jsonb_build_array('+61 400 222 222'),
      'emails', jsonb_build_array('bakery@example.com'),
      'website','https://shadowbakery.example',
      'contact_name','Casey Prime',
      'contact_position','Manager',
      'socials', jsonb_build_object(
        'facebook', null,
        'instagram', null,
        'twitter', null,
        'youtube', null,
        'linkedin', null,
        'tiktok', null
      )
    )
  )
  ON CONFLICT (slug) DO UPDATE SET
    ambassador_id = EXCLUDED.ambassador_id,
    status = EXCLUDED.status,
    source = 'seed',
    golden_record = EXCLUDED.golden_record;

  -- Shadow Cafe
  INSERT INTO public.leads (slug, ambassador_id, status, source, golden_record)
  VALUES (
    'shadow-cafe',
    v_user_id,
    'paid',
    'seed',
    jsonb_build_object(
      'name','Shadow Cafe',
      'industry', null,
      'address','300 Bean Ave, Brisbane QLD',
      'phones', jsonb_build_array('+61 400 333 333'),
      'emails', jsonb_build_array('cafe@example.com'),
      'website','https://shadowcafe.example',
      'contact_name','Jordan Prime',
      'contact_position','Owner',
      'socials', jsonb_build_object(
        'facebook', null,
        'instagram', null,
        'twitter', null,
        'youtube', null,
        'linkedin', null,
        'tiktok', null
      )
    )
  )
  ON CONFLICT (slug) DO UPDATE SET
    ambassador_id = EXCLUDED.ambassador_id,
    status = EXCLUDED.status,
    source = 'seed',
    golden_record = EXCLUDED.golden_record;
END;
$$;

comment on function public.seed_demo_leads(text) is 'Seeds 3 demo leads (prospecting, agreed, paid) assigned to the user with the given email.';
