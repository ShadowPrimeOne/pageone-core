import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const auditId = searchParams.get('auditId')
    if (!auditId) return NextResponse.json({ ok: false, error: 'Missing auditId' }, { status: 400 })

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('nap_observations')
      .select('source_url, source_type, name, address, phone, match_score, mismatch')
      .eq('audit_id', auditId)
      .order('id', { ascending: true })

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
