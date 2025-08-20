import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isHttpUrl(u?: string): u is string {
  if (!u) return false
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' } catch { return false }
}

function detectSocialKey(u: string): { key: string|null, normalized: string } {
  const url = new URL(u)
  const host = url.hostname.replace(/^www\./, '')
  const normalized = `${url.protocol}//${url.host}${url.pathname}`
  if (host.includes('facebook.com')) return { key: 'facebook', normalized }
  if (host.includes('instagram.com')) return { key: 'instagram', normalized }
  if (host.includes('linkedin.com')) return { key: 'linkedin', normalized }
  if (host.includes('x.com') || host.includes('twitter.com')) return { key: 'x', normalized }
  if (host.includes('youtube.com') || host.includes('youtu.be')) return { key: 'youtube', normalized }
  if (host.includes('tiktok.com')) return { key: 'tiktok', normalized }
  return { key: null, normalized }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { businessId, auditId, url, key: providedKey, replace } = body || {}
    if (!businessId || !isHttpUrl(url)) {
      return NextResponse.json({ ok: false, error: 'Missing businessId or invalid url' }, { status: 400 })
    }

    const { key: detectedKey, normalized } = detectSocialKey(url)
    const key: string | null = providedKey || detectedKey
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Unsupported social URL' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Load existing socials
    const { data: bp, error: bpErr } = await supabase
      .from('business_profiles')
      .select('id, socials')
      .eq('business_id', businessId)
      .single()
    if (bpErr || !bp) return NextResponse.json({ ok: false, error: bpErr?.message || 'Business not found' }, { status: 404 })

    const socials: Record<string, any> = (bp as any).socials && typeof (bp as any).socials === 'object' ? { ...(bp as any).socials } : {}

    const prev = socials[key] || null
    if (replace || !prev) {
      socials[key] = normalized
    } else if (prev && prev !== normalized) {
      // Do not overwrite unless replace=true
      return NextResponse.json({ ok: false, error: `${key} already set. Use replace to overwrite.`, data: { socials } }, { status: 409 })
    }

    const { error: upErr } = await supabase
      .from('business_profiles')
      .update({ socials })
      .eq('id', (bp as any).id)
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    if (auditId) {
      await supabase
        .from('business_snapshots')
        .insert({
          business_id: businessId,
          audit_id: auditId,
          source: 'manual',
          data: { social_set: { key, prev, next: socials[key], at: new Date().toISOString() } },
        })
    }

    return NextResponse.json({ ok: true, data: { socials, changed: { key, prev, next: socials[key] } } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
