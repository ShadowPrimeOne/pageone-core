import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { candidate, leadId } = body || {}
    if (!candidate || !candidate.title) {
      return NextResponse.json({ ok: false, error: 'Missing candidate.title' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Create business profile from candidate
    const insertProfile = {
      lead_id: leadId ?? null,
      place_cid: candidate.cid ?? null,
      golden_name: candidate.title ?? null,
      golden_address: candidate.address ?? null,
      golden_phone: candidate.phoneNumber ?? null,
      website: candidate.website ?? null,
      socials: null,
      categories: candidate.category ? [candidate.category] : null,
    }

    const { data: bp, error: bpErr } = await supabase
      .from('business_profiles')
      .insert(insertProfile)
      .select('id')
      .single()
    if (bpErr) return NextResponse.json({ ok: false, error: bpErr.message }, { status: 500 })

    // Create audit run
    const { data: ar, error: arErr } = await supabase
      .from('audit_runs')
      .insert({ business_id: bp.id, status: 'pending' })
      .select('id, status, started_at')
      .single()
    if (arErr) return NextResponse.json({ ok: false, error: arErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, data: { auditId: ar.id as string, businessId: bp.id as string } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
