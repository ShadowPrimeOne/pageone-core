import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { name, address, phone } = body || {}
    if (!name && !address && !phone) {
      return NextResponse.json({ ok: false, error: 'Provide at least one of name, address, phone' }, { status: 400 })
    }

    const qParts = [name, address, phone].filter(Boolean)
    const queryStr = qParts.join(' ').trim()

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
        const extractCid = (u: string): string | undefined => {
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
        const candidates = results.slice(0, 10).map((r, i) => ({
          position: i + 1,
          title: r.title || queryStr || 'Result',
          address: undefined,
          website: undefined,
          phoneNumber: undefined,
          category: undefined,
          rating: undefined,
          ratingCount: undefined,
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
        return {
          position: i + 1,
          title: r.title || r.pretty_url || 'Result',
          address: r.content || undefined,
          website: undefined,
          phoneNumber: undefined,
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
