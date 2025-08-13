-- Enforce required Golden Record fields when leads advance beyond prospecting
-- Required: name (Business Name), address, phones[0], emails[0]
-- Optional: industry, website, socials (facebook, instagram, twitter, youtube, linkedin, tiktok)

create or replace function public.validate_golden_record(gr jsonb)
returns boolean language plpgsql as $$
begin
  if gr is null then
    return false;
  end if;

  -- name required
  if coalesce(trim(gr->>'name'), '') = '' then
    return false;
  end if;

  -- address required (stored as text in MVP)
  if coalesce(trim(gr->>'address'), '') = '' then
    return false;
  end if;

  -- phones required: array length >= 1
  if jsonb_typeof(gr->'phones') <> 'array' or jsonb_array_length(gr->'phones') < 1 then
    return false;
  end if;

  -- emails required: array length >= 1
  if jsonb_typeof(gr->'emails') <> 'array' or jsonb_array_length(gr->'emails') < 1 then
    return false;
  end if;

  return true;
end;
$$;

-- BEFORE INSERT/UPDATE trigger: when status is set to audited/qualified/agreed/paid/converted/onboarded,
-- require a valid Golden Record.
create or replace function public.enforce_golden_record_required()
returns trigger language plpgsql as $$
begin
  if new.status in ('audited','qualified','agreed','paid','converted','onboarded') then
    if not public.validate_golden_record(new.golden_record) then
      raise exception 'Golden Record incomplete: requires name, address, phones[0], emails[0]'
        using errcode = '23514'; -- check_violation
    end if;
  end if;
  return new;
end;
$$;

-- Attach trigger to leads
 drop trigger if exists leads_enforce_golden_record on public.leads;
create trigger leads_enforce_golden_record
before insert or update on public.leads
for each row execute function public.enforce_golden_record_required();
