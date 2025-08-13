-- Ensure is_dev() works under RLS by running as SECURITY DEFINER
-- This prevents profiles RLS from blocking the check and avoids recursion

create or replace function public.is_dev(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = uid and p.role = 'dev'
  );
$$;

grant execute on function public.is_dev(uuid) to authenticated;
