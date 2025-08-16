import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { ensureBusiness, findBusinessIdByProfileKeys, upsertBusinessProfile, setGoldenProfile } from '@/lib/business/unified'
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { candidate, leadId, provider, raw, allResults, ownerId, ambassadorId } = body || {}
    if (!candidate || !candidate.title) {
      return NextResponse.json({ ok: false, error: 'Missing candidate.title' }, { status: 400 })
    }

    function normalizePhoneAU(s?: string): string | null {
      if (!s) return null
      const digits = s.replace(/\D/g, '')
      if (!digits) return null
      if (digits.startsWith('0')) return '+61' + digits.slice(1)
      if (digits.startsWith('61')) return '+61' + digits.slice(2)
      if (s.startsWith('+')) return s
      return '+61' + digits
    }

    // Simple slugify for creating lead slugs when confirming from search
    function slugify(input: string): string {
      return (input || 'lead')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 50) || 'lead'
    }

    const supabase = createAdminClient()
    // Try to derive the acting user from cookies/session; prefer this over any client-provided ownerId.
    const serverSb = await createServerSupabase()
    const { data: userData } = await serverSb.auth.getUser().catch(() => ({ data: { user: null } } as any))
    const authUserId: string | null = (userData as any)?.user?.id ?? null
    const effectiveOwnerId: string | null = authUserId ?? (ownerId ?? null)
    const effectiveAmbassadorId: string | null = (ambassadorId ?? effectiveOwnerId) ?? null

    const serperRaw = raw && typeof raw === 'object' ? raw : candidate.raw || null
    const placeId: string | null = serperRaw?.placeId ?? null
    const fid: string | null = serperRaw?.fid ?? null
    const thumb: string | null = serperRaw?.thumbnailUrl ?? null
    const openingHours: any = serperRaw?.openingHours ?? null

    const primaryCategory: string | null = serperRaw?.type || candidate.category || (Array.isArray(serperRaw?.types) ? serperRaw.types[0] : null)
    const categoriesArr: string[] | null = Array.isArray(serperRaw?.types)
      ? serperRaw.types
      : candidate.category
      ? [candidate.category]
      : null

    const lat = typeof candidate.latitude === 'number' ? candidate.latitude : serperRaw?.latitude
    const lng = typeof candidate.longitude === 'number' ? candidate.longitude : serperRaw?.longitude

    const mapsUrl = candidate.cid
      ? `https://www.google.com/maps?cid=${encodeURIComponent(candidate.cid)}`
      : placeId
      ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
      : null

    // Ensure we always operate on a Lead. If no leadId provided, create a new lead from the candidate (source: 'search').
    let finalLeadId: string | null = leadId ?? null
    if (!finalLeadId) {
      const gr: any = {
        name: candidate.title ?? null,
        address: candidate.address ?? null,
        phones: candidate.phoneNumber ? [candidate.phoneNumber] : [],
        emails: [],
        website: candidate.website ?? serperRaw?.website ?? null,
        socials: {},
      }
      const slug = slugify(candidate.title || 'Lead')
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          slug,
          golden_record: gr,
          source: 'search',
          owner_id: effectiveOwnerId,
          ambassador_id: effectiveAmbassadorId,
        })
        .select('id')
        .single()
      if (leadErr) return NextResponse.json({ ok: false, error: leadErr.message }, { status: 500 })
      finalLeadId = (newLead as any).id as string
    }

    const profilePayload: any = {
      lead_id: finalLeadId,
      place_cid: candidate.cid ?? null,
      golden_name: candidate.title ?? null,
      golden_address: candidate.address ?? null,
      golden_phone: normalizePhoneAU(candidate.phoneNumber ?? undefined),
      website: candidate.website ?? serperRaw?.website ?? null,
      socials: null,
      categories: categoriesArr,
      primary_category: primaryCategory,
      rating: typeof candidate.rating === 'number' ? candidate.rating : serperRaw?.rating ?? null,
      rating_count: typeof candidate.ratingCount === 'number' ? candidate.ratingCount : serperRaw?.ratingCount ?? serperRaw?.user_ratings_total ?? null,
      latitude: typeof lat === 'number' ? lat : null,
      longitude: typeof lng === 'number' ? lng : null,
      google_place_id: placeId,
      google_fid: fid,
      google_thumbnail_url: thumb,
      opening_hours: openingHours ? openingHours : null,
      google_maps_url: mapsUrl,
    }

    // Resolve business using unified model (businesses.id as source of truth)
    let businessId: string | null = null
    if (candidate.cid || placeId) {
      businessId = await findBusinessIdByProfileKeys(supabase, { place_cid: candidate.cid ?? null, google_place_id: placeId })
    }
    if (!businessId) {
      const ensured = await ensureBusiness(supabase, { leadId: finalLeadId ?? null, nameFallback: candidate.title, ownerIdFallback: effectiveOwnerId })
      businessId = ensured.businessId
    }

    // Persist golden profile to businesses table
    await setGoldenProfile(supabase, businessId, {
      name: profilePayload.golden_name,
      address: profilePayload.golden_address,
      phone: profilePayload.golden_phone,
      website: profilePayload.website,
    })

    // Upsert normalized fields into business_profiles by business_id
    await upsertBusinessProfile(supabase, businessId, profilePayload)

    // Create audit run (running)
    const { data: ar, error: arErr } = await supabase
      .from('audit_runs')
      .insert({ business_id: businessId, status: 'running' })
      .select('id')
      .single()
    if (arErr) return NextResponse.json({ ok: false, error: arErr.message }, { status: 500 })

    // Persist raw snapshot from provider
    const snapshot = {
      provider: provider || 'unknown',
      type: 'maps',
      selected: serperRaw || candidate,
      allResults: Array.isArray(allResults) ? allResults : undefined,
      capturedAt: new Date().toISOString(),
    }
    const { error: snapErr } = await supabase
      .from('business_snapshots')
      .insert({ business_id: businessId, audit_id: ar.id, source: 'places', data: snapshot })
    if (snapErr) return NextResponse.json({ ok: false, error: snapErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, data: { auditId: ar.id as string, businessId: businessId as string } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
