import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AU_DIRECTORY_HOSTS, AU_SOCIAL_HOSTS, AU_MAPS_PLACES_HOSTS } from '@/lib/discovery/au_directories'

const KNOWN_SOCIAL = AU_SOCIAL_HOSTS
const KNOWN_DIRECTORIES = AU_DIRECTORY_HOSTS
const KNOWN_MAPS = AU_MAPS_PLACES_HOSTS

function hostOf(u: string): string | null { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }
function classifyHost(host: string): 'social'|'directory'|'places'|'web' {
  if (KNOWN_MAPS.some(d => host.endsWith(d)) || /google\.[^/]*\/maps/i.test(host)) return 'places'
  if (KNOWN_SOCIAL.some(d => host.endsWith(d))) return 'social'
  if (KNOWN_DIRECTORIES.some(d => host.endsWith(d))) return 'directory'
  return 'web'
}

function buildQueries(input: { name?: string|null; address?: string|null; phone?: string|null; websiteHost?: string|null; cityGuess?: string|null; }) {
  const q: string[] = []
  const { name, address, phone, websiteHost, cityGuess } = input
  if (name && phone) q.push(`${name} ${phone}`)
  if (name && address) q.push(`${name} ${address}`)
  if (name && cityGuess) q.push(`${name} ${cityGuess}`)
  if (websiteHost) q.push(`site:${websiteHost}`)
  for (const d of KNOWN_SOCIAL) {
    if (name && cityGuess) q.push(`site:${d} ${name} ${cityGuess}`)
    else if (name) q.push(`site:${d} ${name}`)
  }
  for (const d of KNOWN_DIRECTORIES) {
    if (name && cityGuess) q.push(`site:${d} ${name} ${cityGuess}`)
    else if (name) q.push(`site:${d} ${name}`)
  }
  // De-dup
  return Array.from(new Set(q))
}

function cityFromAddress(address?: string|null): string|null {
  if (!address) return null
  // naive split by comma, take second token as city/suburb guess
  const parts = address.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length >= 2) return parts[1]
  return parts[0] || null
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { businessId, auditId } = body || {}
    if (!businessId) return NextResponse.json({ ok: false, error: 'Missing businessId' }, { status: 400 })

    const supabase = createAdminClient()
    const { data: bp, error: bpErr } = await supabase
      .from('business_profiles')
      .select('id, golden_name, golden_address, golden_phone, website')
      .eq('business_id', businessId)
      .single()
    if (bpErr || !bp) return NextResponse.json({ ok: false, error: bpErr?.message || 'Business not found' }, { status: 404 })

    const websiteHost = bp.website ? hostOf(bp.website) : null
    const cityGuess = cityFromAddress(bp.golden_address)

    const searx = process.env.SEARXNG_BASE_URL
    if (!searx) return NextResponse.json({ ok: false, error: 'SEARXNG_BASE_URL not configured' }, { status: 500 })

    const queries = buildQueries({ name: bp.golden_name, address: bp.golden_address, phone: bp.golden_phone, websiteHost, cityGuess })

    const allItems: Array<{ url: string; title?: string; content?: string; host: string; source_type: 'social'|'directory'|'places'|'web' }> = []

    for (const q of queries) {
      const u = new URL('/search', searx)
      u.searchParams.set('q', q)
      u.searchParams.set('format', 'json')
      u.searchParams.set('safesearch', '0')
      u.searchParams.set('language', 'en-AU')
      u.searchParams.set('engines', 'google_au')
      const res = await fetch(u.toString(), { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      if (!res.ok) continue
      const data = await res.json().catch(() => ({} as any))
      const results: any[] = Array.isArray(data?.results) ? data.results : []
      for (const r of results) {
        if (!r?.url || typeof r.url !== 'string') continue
        const host = hostOf(r.url)
        if (!host) continue
        const type = classifyHost(host)
        allItems.push({ url: r.url, title: r.title, content: r.content, host, source_type: type })
      }
      // Rate-limit lightly between queries (best-effort)
      await new Promise(r => setTimeout(r, 120))
    }

    // Dedup by URL (without query params)
    const seen = new Set<string>()
    const urls: typeof allItems = []
    for (const item of allItems) {
      try {
        const u = new URL(item.url)
        u.search = ''
        u.hash = ''
        const key = `${u.protocol}//${u.host}${u.pathname}`
        if (seen.has(key)) continue
        seen.add(key)
        urls.push({ ...item, url: key })
      } catch {
        // keep original
        if (!seen.has(item.url)) {
          seen.add(item.url)
          urls.push(item)
        }
      }
    }

    // Save discovery snapshot
    const snapshot = {
      provider: 'searxng',
      queries,
      urls,
      capturedAt: new Date().toISOString(),
    }
    if (auditId) {
      await supabase
        .from('business_snapshots')
        .insert({ business_id: businessId, audit_id: auditId, source: 'manual', data: { discovery: snapshot } })
    }

    return NextResponse.json({ ok: true, data: { provider: 'searxng', urls } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
