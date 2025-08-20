import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { setGoldenProfile } from '@/lib/business/unified'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function hostOf(u: string): string | null { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { auditId, businessId, website } = body || {}
    if (!businessId || !website) return NextResponse.json({ ok: false, error: 'Missing businessId or website' }, { status: 400 })

    let url: URL
    try {
      url = new URL(website)
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid website URL' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch existing profile basics to preserve other golden fields
    const { data: bp, error: bpErr } = await supabase
      .from('business_profiles')
      .select('id, golden_name, golden_address, golden_phone, website')
      .eq('business_id', businessId)
      .single()
    if (bpErr || !bp) return NextResponse.json({ ok: false, error: bpErr?.message || 'Business not found' }, { status: 404 })

    const prevWebsite: string | null = (bp as any).website || null
    const nextWebsite = url.toString()

    // Update business_profiles.website
    const { error: upErr } = await supabase
      .from('business_profiles')
      .update({ website: nextWebsite })
      .eq('id', (bp as any).id)
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    // Update businesses.golden_profile (website field) while preserving other fields
    await setGoldenProfile(supabase, businessId, {
      name: (bp as any).golden_name ?? null,
      address: (bp as any).golden_address ?? null,
      phone: (bp as any).golden_phone ?? null,
      website: nextWebsite,
    })

    // Snapshot the change for audit trail
    if (auditId) {
      await supabase
        .from('business_snapshots')
        .insert({
          business_id: businessId,
          audit_id: auditId,
          source: 'manual',
          data: { website_set: { prev: prevWebsite, next: nextWebsite, at: new Date().toISOString() } },
        })
    }

    return NextResponse.json({ ok: true, data: { website: nextWebsite, host: hostOf(nextWebsite) } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
