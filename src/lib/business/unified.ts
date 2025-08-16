import { PostgrestSingleResponse } from '@supabase/supabase-js'

// Utility slugify (local copy to avoid cross-imports)
function slugify(input: string): string {
  return (input || 'client')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50) || 'client'
}

export async function createBusinessWithUniqueSlug(
  supabase: any,
  name: string,
  ownerId: string | null
): Promise<string> {
  const base = slugify(name || 'client')
  let attempt = 0
  while (attempt < 50) {
    const slug = attempt === 0 ? base : `${base}-${attempt}`
    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (!existing) {
      const { data: created, error } = await supabase
        .from('businesses')
        .insert({ name, slug, owner_id: ownerId ?? null, is_public: true })
        .select('id')
        .single()
      if (error) throw error
      return created.id as string
    }
    attempt++
  }
  throw new Error('Could not create unique business slug')
}

export async function ensureMembership(
  supabase: any,
  businessId: string,
  userId: string
) {
  const { data: mem } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('user_id', userId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (!mem) {
    const { error } = await supabase
      .from('memberships')
      .insert({ user_id: userId, business_id: businessId })
    if (error && (error as any).code !== '23505') throw error
  }
}

export async function ensureBusiness(
  supabase: any,
  opts: { leadId?: string | null; nameFallback?: string; ownerIdFallback?: string | null }
): Promise<{ businessId: string; ownerId: string | null }> {
  const leadId = opts.leadId || null
  if (leadId) {
    const { data: lead, error } = await supabase
      .from('leads')
      .select('id, owner_id, ambassador_id, business_id, golden_record')
      .eq('id', leadId)
      .maybeSingle()
    if (error || !lead) throw new Error('Lead not found')
    let businessId: string | null = (lead as any).business_id || null
    const ownerId: string | null = (lead as any).owner_id ?? (lead as any).ambassador_id ?? null
    if (!businessId) {
      const name = (lead as any)?.golden_record?.name || opts.nameFallback || 'Client'
      businessId = await createBusinessWithUniqueSlug(supabase, name, ownerId)
      await supabase.from('leads').update({ business_id: businessId }).eq('id', lead.id)
    }
    if (ownerId) {
      await supabase.from('businesses').update({ owner_id: ownerId }).eq('id', businessId).is('owner_id', null)
    }
    return { businessId, ownerId }
  }
  const name = opts.nameFallback || 'Client'
  const ownerId = opts.ownerIdFallback ?? null
  const businessId = await createBusinessWithUniqueSlug(supabase, name, ownerId)
  // Do not create membership here; only after agreement/payment in conversion flows
  return { businessId, ownerId }
}

export async function setGoldenProfile(
  supabase: any,
  businessId: string,
  golden: any
) {
  const { error } = await supabase
    .from('businesses')
    .update({ golden_profile: golden ?? null })
    .eq('id', businessId)
  if (error) throw error
}

export async function upsertBusinessProfile(
  supabase: any,
  businessId: string,
  patch: Record<string, any>
): Promise<{ profileId: string }> {
  const { data: existing } = await supabase
    .from('business_profiles')
    .select('id')
    .eq('business_id', businessId)
    .maybeSingle()
  if (existing?.id) {
    const { error } = await supabase
      .from('business_profiles')
      .update({ ...patch, business_id: businessId })
      .eq('id', existing.id)
    if (error) throw error
    return { profileId: existing.id as string }
  }
  const { data: created, error } = await supabase
    .from('business_profiles')
    .insert({ ...patch, business_id: businessId })
    .select('id')
    .single()
  if (error) throw error
  return { profileId: created.id as string }
}

export async function findBusinessIdByProfileKeys(
  supabase: any,
  keys: { place_cid?: string | null; google_place_id?: string | null }
): Promise<string | null> {
  const ors: string[] = []
  if (keys.place_cid) ors.push(`place_cid.eq.${keys.place_cid}`)
  if (keys.google_place_id) ors.push(`google_place_id.eq.${keys.google_place_id}`)
  if (ors.length === 0) return null
  const { data, error } = await supabase
    .from('business_profiles')
    .select('business_id')
    .or(ors.join(','))
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data as any)?.business_id || null
}

export async function getProfileBasics(
  supabase: any,
  businessId: string
): Promise<{ id: string | null; golden_name: string | null; golden_address: string | null; golden_phone: string | null; website: string | null; place_cid: string | null } | null> {
  const { data } = await supabase
    .from('business_profiles')
    .select('id, golden_name, golden_address, golden_phone, website, place_cid')
    .eq('business_id', businessId)
    .maybeSingle()
  if (!data) return null
  return data as any
}
