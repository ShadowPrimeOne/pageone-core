import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ auditId: string }> }) {
  try {
    const { auditId } = await ctx.params
    if (!auditId) return NextResponse.json({ ok: false, error: 'Missing auditId' }, { status: 400 })

    const supabase = createAdminClient()

    // Fetch audit run
    const { data: audit, error: auditErr } = await supabase
      .from('audit_runs')
      .select('id, business_id, status, started_at, completed_at, summary')
      .eq('id', auditId)
      .single()
    if (auditErr || !audit) return NextResponse.json({ ok: false, error: auditErr?.message || 'Not found' }, { status: 404 })

    // Fetch business profile basics
    const { data: biz } = await supabase
      .from('business_profiles')
      .select('id, golden_name, golden_address, golden_phone, website, place_cid, socials')
      .eq('business_id', audit.business_id)
      .single()

    // Count related records
    const [snapshotsRes, napRes, listRes, adsRes, lhRes] = await Promise.all([
      supabase.from('business_snapshots').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
      supabase.from('nap_observations').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
      supabase.from('listing_opportunities').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
      supabase.from('ads_audit').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
      supabase.from('lighthouse_runs').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
    ])

    const counts = {
      snapshots: snapshotsRes.count ?? 0,
      nap_observations: napRes.count ?? 0,
      listing_opportunities: listRes.count ?? 0,
      ads_audit: adsRes.count ?? 0,
      lighthouse_runs: lhRes.count ?? 0,
    }

    // Derive simple step statuses
    const steps = {
      nap_confirmed: Boolean(biz?.golden_name || biz?.golden_address || biz?.golden_phone),
      snapshot: counts.snapshots > 0,
      discovery: counts.nap_observations > 0,
      ads: counts.ads_audit > 0,
      lighthouse: counts.lighthouse_runs > 0,
      complete: audit.status === 'complete',
    }

    return NextResponse.json({ ok: true, data: { audit, business: biz, counts, steps } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
