import { NextResponse } from 'next/server'

function extractCid(u: string): string | undefined {
  try {
    const url = new URL(u)
    const cid = url.searchParams.get('cid')
    if (cid) return cid
  } catch {}
  try {
    const m = u.match(/:0x[0-9a-f]+/i)
    if (m) return m[0].slice(1)
  } catch {}
  return undefined
}

function extractPhoneAu(text?: string): string | undefined {
  if (!text) return undefined
  // Simple AU phone patterns: +61 X..., or 0X... with separators
  const m = text.match(/(\+61\s?\d[\d\s-]{7,12}|0\d[\d\s-]{7,10})/)
  return m ? m[1].trim() : undefined
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { name, address, phone } = body || {}
    if (!name && !address && !phone) {
      return NextResponse.json({ ok: false, error: 'Provide at least one of name, address, phone' }, { status: 400 })
    }

    const qParts = [name, address, phone].filter(Boolean)
    const queryStr = qParts.join(' ').trim()

    // Optional first-line: Serper.dev provider
    const provider = (process.env.GOLDEN_SEARCH_PROVIDER || '').toLowerCase()
    if (provider === 'serper') {
      const apiKey = process.env.SERPER_API_KEY
      const baseUrl = 'https://google.serper.dev/search'
      const gl = (process.env.SERPER_GL || 'au').toLowerCase()
      const hl = process.env.SERPER_HL || 'en'

      async function serperQuery(type: 'maps' | 'places') {
        const u = new URL(baseUrl)
        u.searchParams.set('q', queryStr)
        u.searchParams.set('type', type)
        u.searchParams.set('gl', gl)
        // page/num are optional; defaults are fine for our use-case
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        if (apiKey) headers['X-API-KEY'] = apiKey
        // Serper also supports apiKey in query; only add if no header key present
        if (!apiKey) u.searchParams.set('apiKey', process.env.SERPER_API_KEY_QUERY || '')
        const res = await fetch(u.toString(), { headers, cache: 'no-store' })
        if (!res.ok) return { ok: false as const, data: null as any }
        const json = await res.json().catch(() => ({}))
        const places: any[] = Array.isArray(json?.places) ? json.places : []
        const candidates = places.slice(0, 10).map((r: any, i: number) => ({
          position: r.position ?? i + 1,
          title: r.title || r.name || queryStr || 'Result',
          address: r.address || r.formattedAddress || undefined,
          latitude: r.latitude,
          longitude: r.longitude,
          website: r.website || undefined,
          phoneNumber: r.phoneNumber || r.phone || undefined,
          category: r.type || r.category || (Array.isArray(r.types) ? r.types[0] : undefined),
          rating: r.rating || undefined,
          ratingCount: r.ratingCount || r.user_ratings_total || undefined,
          cid: r.cid || undefined,
          raw: r,
          // Note: placeId/fid/openingHours exist on maps type, but our contract doesn't require them here
        }))
        return { ok: true as const, candidates, places }
      }

      try {
        // Prefer richer MAPS payload; fallback to PLACES if empty
        let first = await serperQuery('maps')
        if (!first.ok || (Array.isArray(first.candidates) && first.candidates.length === 0)) {
          first = await serperQuery('places')
        }
        if (first.ok) {
          return NextResponse.json({ ok: true, data: { candidates: first.candidates, provider: 'serper', allResults: first.places } })
        }
        // else fall through to worker path
      } catch {
        // ignore and continue to worker fallback
      }
    }

    // Prefer Playwright worker if available; defaults to local worker if not configured
    const base = process.env.SCRAPER_WORKER_URL || 'http://localhost:8787'
    if (base) {
      const workerUrl = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(queryStr)}`
      const controller = new AbortController()
      const timeoutMs = Number(process.env.WORKER_TIMEOUT_MS || 10000)
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(workerUrl, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
          cache: 'no-store',
        })
        clearTimeout(timer)
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return NextResponse.json({ ok: false, error: `Worker error: ${text || res.status}` }, { status: 502 })
        }
        const data = await res.json()
        const results: any[] = Array.isArray(data?.results) ? data.results : []
        const candidates = results.slice(0, 10).map((r, i) => ({
          position: i + 1,
          title: r.title || queryStr || 'Result',
          address: r.address || r.location || r.content || undefined,
          website: r.website || undefined,
          phoneNumber: r.phoneNumber || r.phone || undefined,
          category: r.category || undefined,
          rating: r.rating || undefined,
          ratingCount: r.ratingCount || r.reviews || undefined,
          cid: typeof r?.url === 'string' ? extractCid(r.url) : undefined,
          sourceUrl: r?.url,
        }))
        return NextResponse.json({ ok: true, data: { candidates } })
      } catch (e: any) {
        clearTimeout(timer)
        // Fall through to SearXNG if worker fails/times out
      }
    }

    // Fallback: use SearXNG to quickly get Google Maps links for the query
    const searx = process.env.SEARXNG_BASE_URL
    if (searx) {
      const q = [name, address, phone].filter(Boolean).join(' ')
      const u = new URL('/search', searx)
      u.searchParams.set('q', `${q} site:google.com/maps`)
      u.searchParams.set('format', 'json')
      u.searchParams.set('safesearch', '0')
      u.searchParams.set('language', 'en-AU')
      // If you have a google_au engine configured per guide, prefer it
      u.searchParams.set('engines', 'google_au')

      const res = await fetch(u.toString(), { headers: { 'Accept': 'application/json' } })
      if (!res.ok) {
        const text = await res.text()
        return NextResponse.json({ ok: false, error: `SearXNG error: ${text || res.status}` }, { status: 502 })
      }
      const data = await res.json()
      const results: any[] = Array.isArray(data?.results) ? data.results : []
      const maps = results.filter(r => typeof r?.url === 'string' && /google\.[^/]*\/maps/i.test(r.url))
      const candidates = maps.slice(0, 5).map((r, i) => {
        let cid: string | undefined
        try {
          const url = new URL(r.url)
          cid = url.searchParams.get('cid') ?? undefined
        } catch {}
        const addr: string | undefined = r.content || undefined
        const phoneGuess = extractPhoneAu(r.content)
        return {
          position: i + 1,
          title: r.title || r.pretty_url || 'Result',
          address: addr,
          website: undefined,
          phoneNumber: phoneGuess,
          category: undefined,
          rating: undefined,
          ratingCount: undefined,
          cid,
          sourceUrl: r.url,
        }
      })
      return NextResponse.json({ ok: true, data: { candidates } })
    }

    // As a last resort, return no candidates but do not error
    return NextResponse.json({ ok: true, data: { candidates: [] } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
