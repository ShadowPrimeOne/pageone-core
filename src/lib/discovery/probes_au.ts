// Deterministic AU directory probes via Serper site-restricted queries
// Returns top candidate listing URLs per directory host

export type ProbeResult = { url: string; title?: string; snippet?: string; host: string }

function hostOf(u: string): string | null { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }

function cityFromAddress(address?: string | null): string | null {
  if (!address) return null
  const parts = address.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length >= 2) return parts[1]
  return parts[0] || null
}
function stateFromAddress(address?: string | null): string | null {
  if (!address) return null
  const m = address.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i)
  return m ? m[1].toUpperCase() : null
}
function postcodeFromAddress(address?: string | null): string | null {
  if (!address) return null
  const m = address.match(/\b(\d{4})\b/)
  return m ? m[1] : null
}

const HOSTS = [
  'yellowpages.com.au',
  'localsearch.com.au',
  'truelocal.com.au',
  'womo.com.au',
  'oneflare.com.au',
]

export async function runDirectoryProbes(input: { name?: string | null; address?: string | null; limitPerHost?: number }): Promise<ProbeResult[]> {
  const SERPER_KEY = process.env.SERPER_API_KEY
  if (!SERPER_KEY) return []

  const { name, address } = input || {}
  if (!name) return []

  const city = cityFromAddress(address)
  const state = stateFromAddress(address)
  const postcode = postcodeFromAddress(address)
  const perHost = Math.max(1, Math.min(3, input.limitPerHost ?? 2))

  const results: ProbeResult[] = []
  for (const host of HOSTS) {
    // Build a tight query: site:<host> "<name>" <city> <state|postcode>
    const parts: string[] = []
    parts.push(`site:${host}`)
    parts.push(`"${name}"`)
    if (city) parts.push(city)
    if (state) parts.push(state)
    else if (postcode) parts.push(postcode)
    const q = parts.join(' ')

    const body = { q, gl: 'au', hl: 'en', autocorrect: true, num: 5 }
    try {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      if (!r.ok) continue
      const data: any = await r.json().catch(() => ({} as any))
      const organic: any[] = Array.isArray(data?.organic) ? data.organic : []
      const seen = new Set<string>()
      for (const o of organic) {
        const link = o?.link
        if (!link || typeof link !== 'string') continue
        const h = hostOf(link)
        if (!h || !h.endsWith(host)) continue
        // Normalize to scheme+host+path without query/hash for de-dupe
        try {
          const u0 = new URL(link)
          u0.search = ''
          u0.hash = ''
          const norm = `${u0.protocol}//${u0.host}${u0.pathname || '/'}`
          if (seen.has(norm)) continue
          seen.add(norm)
          results.push({ url: norm, title: o.title, snippet: o.snippet, host: h })
          if (seen.size >= perHost) break
        } catch { continue }
      }
    } catch {
      // ignore failures per host
    }
  }
  return results
}
