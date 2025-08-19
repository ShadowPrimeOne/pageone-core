import { NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { createAdminClient } from '@/lib/supabase/admin'
import { AU_DIRECTORY_HOSTS, AU_SOCIAL_HOSTS, AU_MAPS_PLACES_HOSTS } from '@/lib/discovery/au_directories'
import { runDirectoryProbes } from '@/lib/discovery/probes_au'

const KNOWN_SOCIAL = AU_SOCIAL_HOSTS
const KNOWN_DIRECTORIES = AU_DIRECTORY_HOSTS
const KNOWN_MAPS = AU_MAPS_PLACES_HOSTS

// Known AU job boards to gently demote unless strong signals are present
const JOB_BOARD_HOSTS = [
  'healthcarelink.com.au', 'seek.com.au', 'indeed.com.au', 'jora.com', 'careerone.com.au', 'glassdoor.com.au',
]

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
  const state = stateFromAddress(address)
  const postcode = postcodeFromAddress(address)
  if (name && phone) q.push(`"${name}" ${phone}`)
  if (name && address) q.push(`"${name}" ${address}`)
  if (name && cityGuess) q.push(`"${name}" ${cityGuess}`)
  if (name && cityGuess && state) q.push(`"${name}" ${cityGuess} ${state}`)
  if (name && cityGuess) q.push(`${name} ${cityGuess} site:.au`)
  if (name && state) q.push(`${name} ${state} site:.au`)
  // Phone-only broad queries (web + AU bias)
  if (phone) {
    q.push(`${phone}`)
    q.push(`${phone} site:.au`)
  }
  // Address-only broad queries (quoted to reduce noise)
  if (address) {
    q.push(`"${address}"`)
    if (cityGuess) q.push(`"${address}" ${cityGuess}`)
    if (postcode) q.push(`"${address}" ${postcode}`)
    const firstLine = address.split(',')[0]?.trim()
    if (firstLine) {
      if (cityGuess && state) q.push(`"${firstLine}" ${cityGuess} ${state}`)
      if (cityGuess) q.push(`"${firstLine}" ${cityGuess}`)
      if (postcode) q.push(`"${firstLine}" ${postcode}`)
    }
  }
  for (const d of KNOWN_SOCIAL) {
    if (name && cityGuess) q.push(`site:${d} "${name}" ${cityGuess}`)
    if (name) q.push(`site:${d} "${name}"`)
    if (phone) q.push(`site:${d} ${phone}`)
    if (address) {
      const firstLine = address.split(',')[0]?.trim()
      if (firstLine) q.push(`site:${d} "${firstLine}"`)
    }
  }
  for (const d of KNOWN_DIRECTORIES) {
    if (name && cityGuess) q.push(`site:${d} "${name}" ${cityGuess}`)
    if (name) q.push(`site:${d} "${name}"`)
    if (phone) q.push(`site:${d} ${phone}`)
    if (address) q.push(`site:${d} "${address}"`)
  }
  // De-dup (do not add -site filter; we will filter exact website URL later)
  const uniq = Array.from(new Set(q))
  return uniq
}

function cityFromAddress(address?: string|null): string|null {
  if (!address) return null
  // naive split by comma, take second token as city/suburb guess
  const parts = address.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length >= 2) return parts[1]
  return parts[0] || null
}

function stateFromAddress(address?: string|null): string|null {
  if (!address) return null
  const m = address.match(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i)
  return m ? m[1].toUpperCase() : null
}

function postcodeFromAddress(address?: string|null): string|null {
  if (!address) return null
  const m = address.match(/\b(\d{4})\b/)
  return m ? m[1] : null
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    let { businessId, auditId } = body || {}

    const supabase = createAdminClient()

    // Resolve businessId from auditId if not provided
    if (!businessId && auditId) {
      const { data: audit, error: auditErr } = await supabase
        .from('audit_runs')
        .select('id, business_id')
        .eq('id', auditId)
        .single()
      if (auditErr || !audit) return NextResponse.json({ ok: false, error: auditErr?.message || 'Audit not found' }, { status: 404 })
      businessId = audit.business_id
    }

    if (!businessId) return NextResponse.json({ ok: false, error: 'Missing businessId or auditId' }, { status: 400 })
    const { data: bp, error: bpErr } = await supabase
      .from('business_profiles')
      .select('id, golden_name, golden_address, golden_phone, website')
      .eq('business_id', businessId)
      .single()
    if (bpErr || !bp) return NextResponse.json({ ok: false, error: bpErr?.message || 'Business not found' }, { status: 404 })

    const websiteHost = bp.website ? hostOf(bp.website) : null
    const cityGuess = cityFromAddress(bp.golden_address)
    const expectedState = stateFromAddress(bp.golden_address)

    const searx = process.env.SEARXNG_BASE_URL || 'https://searxng.pageone.live'

    const queries = buildQueries({ name: bp.golden_name, address: bp.golden_address, phone: bp.golden_phone, websiteHost, cityGuess })

    // Helper: fetch with timeout and minimal diagnostics
    async function fetchWithTimeout(url: string, ms: number) {
      const controller = new AbortController()
      const to = setTimeout(() => controller.abort(new Error('timeout')), ms)
      const started = Date.now()
      try {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store', signal: controller.signal })
        const elapsed = Date.now() - started
        return { res, elapsed }
      } finally { clearTimeout(to) }
    }

    const allItems: Array<{ url: string; title?: string; content?: string; host: string; source_type: 'social'|'directory'|'places'|'web'; score?: number; rank?: number }> = []

    // --- Relevance scoring helpers ---
    const brandTokens = (bp.golden_name || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((s: string) => Boolean(s))
    const brandPhrase = (bp.golden_name || '').toLowerCase().trim()
    const brandBigrams = brandTokens.slice(0,-1).map((t: string, i: number) => `${t} ${brandTokens[i+1]}`)
    const postcode = (() => {
      const m = (bp.golden_address || '').match(/\b(\d{4})\b/)
      return m ? m[1] : null
    })()
    const phoneDigits = (bp.golden_phone || '').replace(/\D/g, '')
    const isAuHost = (host: string) => /\.au$/i.test(host)
    const AU_HOST_SIGNALS = new Set<string>([...KNOWN_DIRECTORIES, ...KNOWN_SOCIAL])
    const NEG_HOSTS = [
      'empire.edu', 'walmart.com', 'sensationnel.com', 'empirebeautysupply.com', 'empirebeautysupplies.com', 'beautyempirepo.com',
    ]
    const tokenise = (s?: string) => (s||'').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((t: string) => t.length>1)
    const containsAll = (need: string[], have: string[]) => need.every(n => have.includes(n))
    const isJobBoard = (host: string) => JOB_BOARD_HOSTS.some(h => host.endsWith(h))
    const AU_STATE_SET = new Set(['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'])
    const AU_MAJOR_CITIES = ['sydney','melbourne','brisbane','perth','adelaide','hobart','darwin','canberra']
    const OCCUPATION_WORDS = ['physiotherapy','physiotherapist','chiropractor','dentist','dental','doctor','gp','general practitioner','clinic','allied','health','massage','podiatry','podiatrist']
    const scoreItem = (item: { url: string; title?: string; content?: string; host: string; source_type: 'social'|'directory'|'places'|'web' }): { score: number; exact: boolean; bigram: boolean; phone: boolean; geo: boolean; wrongLocation: boolean; occupationOnly: boolean; jobBoard: boolean } => {
      let score = 0
      const titleT = tokenise(item.title)
      const contentT = tokenise(item.content)
      const urlObj = new URL(item.url)
      const pathT = tokenise(urlObj.pathname.replace(/\//g,' '))
      const titleLower = (item.title||'').toLowerCase()
      const contentLower = (item.content||'').toLowerCase()
      const addressLower = (bp.golden_address || '').toLowerCase()
      const streetLineLower = (bp.golden_address || '').split(',')[0]?.trim().toLowerCase()

      // Host class weighting
      if (item.source_type === 'places') score += 12
      else if (item.source_type === 'directory') score += 10
      else if (item.source_type === 'social') score += 10

      // AU signals
      if (isAuHost(item.host)) score += 8
      if (AU_HOST_SIGNALS.has(item.host)) score += 2

      // Name matching
      if (brandTokens.length) {
        const inTitle = brandTokens.filter((t: string) => titleT.includes(t)).length
        const inPath = brandTokens.filter((t: string) => pathT.includes(t)).length
        const inHost = brandTokens.filter((t: string) => item.host.includes(t)).length

        const exactPhraseTitle = !!brandPhrase && titleLower.includes(brandPhrase)
        const exactPhraseContent = !!brandPhrase && contentLower.includes(brandPhrase)
        const bigramHit = brandBigrams.some((bg: string) => titleLower.includes(bg) || contentLower.includes(bg) || pathT.join(' ').includes(bg))

        // Base token contributions
        let tokenScore = inTitle * 4 + inPath * 2 + inHost * 2

        // If brand is made of generic words, require phrase/bigram to trust higher scores
        const GENERIC = new Set(['north','east','south','west','steel','plumbing','electrical','electric','auto','services','pty','ltd'])
        const isGenericBrand = brandTokens.every((t: string) => GENERIC.has(t))

        if (exactPhraseTitle) score += 12
        if (exactPhraseContent) score += 6
        if (bigramHit) score += 6

        if (isGenericBrand) {
          tokenScore = Math.min(tokenScore, (exactPhraseTitle || exactPhraseContent || bigramHit) ? 10 : 4)
        } else {
          tokenScore = Math.min(tokenScore, 16)
        }
        score += tokenScore
      }

      // Geo matching
      if (cityGuess) {
        const city = (cityGuess || '').toLowerCase()
        if (titleLower.includes(city)) score += 6
        if (contentLower.includes(city)) score += 6
        if (pathT.includes(city)) score += 4
      }
      if (/\bnsw\b/i.test(titleLower) || /\bnsw\b/i.test(contentLower)) score += 5
      if (postcode && (item.title||'').includes(postcode)) score += 5
      if (postcode && (item.content||'').includes(postcode)) score += 5

      // Address matching (strong signals)
      if (addressLower && (titleLower.includes(addressLower) || contentLower.includes(addressLower))) score += 20
      if (streetLineLower && (titleLower.includes(streetLineLower) || contentLower.includes(streetLineLower))) score += 10
      if (streetLineLower && postcode && (titleLower.includes(streetLineLower) || contentLower.includes(streetLineLower)) && ((item.title||'').includes(postcode) || (item.content||'').includes(postcode))) score += 8

      // Phone matching
      if (phoneDigits && (item.content||'').replace(/\D/g,'').includes(phoneDigits.replace(/^61/, ''))) score += 12

      // Host relevance
      if (containsAll(['empire','hair'], brandTokens) || containsAll(['empire','beauty'], brandTokens)) {
        if (item.host.includes('empire') && (item.host.includes('hair') || item.host.includes('beauty'))) score += 8
      } else {
        const hits = brandTokens.filter((t: string) => item.host.includes(t)).length
        score += Math.min(6, hits * 2)
      }

      // Penalties
      if (NEG_HOSTS.some(h => item.host.endsWith(h))) score -= 20
      if (/\b(united states|usa|tx|oh|ca|sc|ms|zip\s*\d{5})\b/i.test(contentLower)) score -= 10
      // If brand tokens match only weakly (no phrase/bigram/phone/postcode/city), cap name-driven score by applying a soft penalty
      if (brandTokens.length) {
        const hasStrongBrand = (brandPhrase && (titleLower.includes(brandPhrase) || contentLower.includes(brandPhrase))) || brandBigrams.some((bg: string) => titleLower.includes(bg) || contentLower.includes(bg))
        const hasContact = Boolean(phoneDigits) && (item.content||'').replace(/\D/g,'').includes(phoneDigits.replace(/^61/, ''))
        const hasGeo = Boolean(cityGuess && (titleLower.includes((cityGuess||'').toLowerCase()) || contentLower.includes((cityGuess||'').toLowerCase()))) || Boolean(postcode && ((item.title||'').includes(postcode) || (item.content||'').includes(postcode)))
        if (!hasStrongBrand && !hasContact && !hasGeo) {
          score -= 8
        }
      }

      // Determine strong support signals used by several guards below
      const hasExact = Boolean(brandPhrase) && (titleLower.includes(brandPhrase) || contentLower.includes(brandPhrase))
      const bigram = brandBigrams.some((bg: string) => titleLower.includes(bg) || contentLower.includes(bg))
      const hasContact = Boolean(phoneDigits) && (item.content||'').replace(/\D/g,'').includes(phoneDigits.replace(/^61/, ''))
      const hasGeo = Boolean(cityGuess && (titleLower.includes((cityGuess||'').toLowerCase()) || contentLower.includes((cityGuess||'').toLowerCase()))) || Boolean(postcode && ((item.title||'').includes(postcode) || (item.content||'').includes(postcode)))
      const strongSupportCount = [hasExact, bigram, hasContact, hasGeo].filter(Boolean).length

      // Wrong-location penalty: conflicting AU state/city when our city isn't present
      let wrongLocation = false
      if (expectedState) {
        const stateHits = Array.from(AU_STATE_SET).filter(st => new RegExp(`\\b${st}\\b`, 'i').test(titleLower) || new RegExp(`\\b${st}\\b`, 'i').test(contentLower))
        const hasExpectedState = stateHits.includes(expectedState)
        const hasOtherState = stateHits.some(st => st !== expectedState)
        const hasOurCity = cityGuess ? (titleLower.includes((cityGuess||'').toLowerCase()) || contentLower.includes((cityGuess||'').toLowerCase())) : false
        const otherMajorCity = AU_MAJOR_CITIES.some(c => (titleLower.includes(c) || contentLower.includes(c)))
        if (!hasOurCity && (hasOtherState || otherMajorCity) && !hasExpectedState) {
          score -= 12
          score = Math.min(score, 24)
          wrongLocation = true
        }
      }

      // Occupation-only penalty: if occupation words hit but no brand tokens anywhere
      let occupationOnly = false
      {
        const combined = new Set<string>([...titleT, ...pathT, ...contentT])
        const brandOverlap = brandTokens.filter((t: string) => combined.has(t)).length
        const occHit = OCCUPATION_WORDS.some(w => titleLower.includes(w) || contentLower.includes(w))
        if (occHit && brandOverlap === 0) {
          score -= 10
          score = Math.min(score, 22)
          occupationOnly = true
        }
      }

      // Job-board demotion: if host is a job board and no strong support, penalize and cap
      const jobBoard = isJobBoard(item.host)
      if (jobBoard && strongSupportCount === 0) {
        score -= 10
        score = Math.min(score, 20)
      }

      // Additional guard for generic web pages: if no supporting signals (contact/geo/phrase), lightly penalize and cap tighter
      if (item.source_type === 'web') {
        if (strongSupportCount === 0) {
          const combined = new Set<string>([...titleT, ...pathT, ...contentT])
          const overlap = brandTokens.filter((t: string) => combined.has(t)).length
          const GENERIC2 = new Set(['north','east','south','west','steel','plumbing','electrical','electric','auto','services','pty','ltd'])
          const hasGenericBrand = brandTokens.some((t: string) => GENERIC2.has(t))
          if (hasGenericBrand && overlap <= 1) score -= 6
          score = Math.min(score, 20)
        }
      }

      return { score, exact: hasExact, bigram, phone: hasContact, geo: hasGeo, wrongLocation, occupationOnly, jobBoard }
    }

    // Streaming mode: return progress as events when ?stream=1 or Accept: text/event-stream
    const urlObj = new URL(request.url)
    const accept = request.headers.get('accept') || ''
    const streamMode = urlObj.searchParams.get('stream') === '1' || /text\/event-stream/i.test(accept)

    // Prepare normalized website URL for precise exclusion
    const websiteNormalized = (() => {
      try {
        if (!bp.website) return null
        const w = new URL(bp.website)
        w.search = ''
        w.hash = ''
        // normalize root and trailing slash
        const s = `${w.protocol}//${w.host}${w.pathname || '/'}`
        return s.endsWith('/') ? s : `${s}/`
      } catch { return null }
    })()

    if (streamMode) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder()
          const send = (event: string, data: any) => {
            const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            controller.enqueue(enc.encode(payload))
          }
          ;(async () => {
            const engines = process.env.SEARXNG_ENGINES || 'google,bing,brave,duckduckgo,mojeek'
            const perQueryLimit = parseInt(process.env.SEARXNG_PER_QUERY_LIMIT || '5', 10)
            const delayMs = parseInt(process.env.SEARXNG_QUERY_DELAY_MS || '800', 10)
            send('meta', { provider: 'searxng', searx, engines, queries, limits: { perQueryLimit, delayMs } })
            let searxItems = 0

            // Deterministic AU directory probes via Serper (site-restricted)
            try {
              send('probe:start', { provider: 'serper', kind: 'directories' })
              const probeResults = await runDirectoryProbes({ name: bp.golden_name, address: bp.golden_address, limitPerHost: 2 })
              let pcount = 0
              for (const p of probeResults) {
                const h = p.host || hostOf(p.url)
                if (!h) continue
                const type = classifyHost(h)
                const baseItem = { url: p.url, title: p.title, content: p.snippet, host: h, source_type: type as any }
                const { score, exact, bigram, phone, geo, wrongLocation, occupationOnly, jobBoard } = scoreItem(baseItem)
                const item = { ...baseItem, score, rank: 1, exact, bigram, phone, geo, wrongLocation, occupationOnly, jobBoard }
                allItems.push(item)
                send('probe:item', item)
                pcount++
              }
              send('probe:done', { count: pcount })
            } catch (e: any) {
              send('probe:error', { error: e?.message || 'probe_failed' })
            }
            for (const q of queries) {
              const u = new URL('/search', searx)
              u.searchParams.set('q', q)
              u.searchParams.set('format', 'json')
              u.searchParams.set('safesearch', '0')
              u.searchParams.set('language', 'en-AU')
              u.searchParams.set('limit', String(perQueryLimit))
              if (engines) u.searchParams.set('engines', engines)
              const target = u.toString()
              send('query:start', { q, target })
              try {
                const { res, elapsed } = await fetchWithTimeout(target, 10000)
                if (!res.ok) {
                  send('query:error', { q, status: res.status, elapsed })
                } else {
                  const data = await res.json().catch(() => ({} as any))
                  const results: any[] = Array.isArray(data?.results) ? data.results : []
                  let emitted = 0
                  let badUrl = 0
                  let excludedOwn = 0
                  let idx = 0
                  for (const r of results) {
                    idx++
                    if (!r?.url || typeof r.url !== 'string') { badUrl++; continue }
                    // Exclude only the exact recorded website URL (normalized); allow other hosts and pages
                    try {
                      const u0 = new URL(r.url)
                      u0.search = ''
                      u0.hash = ''
                      const norm = `${u0.protocol}//${u0.host}${u0.pathname || '/'}`
                      const normSlash = norm.endsWith('/') ? norm : `${norm}/`
                      if (websiteNormalized && (normSlash === websiteNormalized)) { excludedOwn++; continue }
                    } catch { badUrl++; continue }
                    const host = hostOf(r.url)
                    if (!host) { badUrl++; continue }
                    const type = classifyHost(host)
                    const baseItem = { url: r.url, title: r.title, content: r.content, host, source_type: type as any }
                    const { score, exact, bigram, phone, geo, wrongLocation, occupationOnly, jobBoard } = scoreItem(baseItem)
                    const item = { ...baseItem, score, rank: idx, exact, bigram, phone, geo, wrongLocation, occupationOnly, jobBoard }
                    allItems.push(item)
                    send('item', item)
                    emitted++
                  }
                  send('query:done', { q, elapsed, count: emitted, total: results.length, badUrl, excludedOwn, unresponsive_engines: data?.unresponsive_engines || [] })
                  searxItems += emitted
                }
              } catch (e: any) {
                send('query:error', { q, error: e?.message || 'fetch_failed' })
              }
              // light rate-limit
              await new Promise(r => setTimeout(r, delayMs))
            }

            // Optional: Serper fallback when SearXNG produced zero items
            try {
              const SERPER_KEY = process.env.SERPER_API_KEY
              const perQueryLimit = parseInt(process.env.SEARXNG_PER_QUERY_LIMIT || '5', 10)
              if (SERPER_KEY && searxItems === 0) {
                send('meta', { provider: 'serper', reason: 'fallback_no_searxng_results' })
                const qFallbacks = queries.slice(0, 2) // keep it tight
                for (const q of qFallbacks) {
                  const body = { q, gl: 'au', hl: 'en', autocorrect: true, num: perQueryLimit }
                  send('query:start', { provider: 'serper', q })
                  const started = Date.now()
                  try {
                    const r2 = await fetch('https://google.serper.dev/search', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
                      body: JSON.stringify(body),
                      cache: 'no-store'
                    })
                    const elapsed = Date.now() - started
                    if (!r2.ok) {
                      send('query:error', { provider: 'serper', q, status: r2.status, elapsed })
                    } else {
                      const data2: any = await r2.json().catch(() => ({} as any))
                      const organic: any[] = Array.isArray(data2?.organic) ? data2.organic : []
                      let emitted = 0
                      let badUrl = 0
                      let excludedOwn = 0
                      let idx = 0
                      for (const r of organic) {
                        idx++
                        const url = r?.link
                        if (!url || typeof url !== 'string') { badUrl++; continue }
                        try {
                          const u0 = new URL(url)
                          u0.search = ''
                          u0.hash = ''
                          const norm = `${u0.protocol}//${u0.host}${u0.pathname || '/'}`
                          const normSlash = norm.endsWith('/') ? norm : `${norm}/`
                          if (websiteNormalized && (normSlash === websiteNormalized)) { excludedOwn++; continue }
                        } catch { badUrl++; continue }
                        const host = hostOf(url)
                        if (!host) { badUrl++; continue }
                        const type = classifyHost(host)
                        const baseItem = { url, title: r.title, content: r.snippet, host, source_type: type as any }
                        const { score, exact, bigram, phone, geo, wrongLocation, occupationOnly, jobBoard } = scoreItem(baseItem)
                        const item = { ...baseItem, score, rank: idx, exact, bigram, phone, geo, wrongLocation, occupationOnly, jobBoard }
                        allItems.push(item)
                        send('item', item)
                        emitted++
                      }
                      send('query:done', { provider: 'serper', q, elapsed, count: emitted, total: organic.length, badUrl, excludedOwn })
                    }
                  } catch (e: any) {
                    send('query:error', { provider: 'serper', q, error: e?.message || 'fetch_failed' })
                  }
                }
              }
            } catch { /* noop */ }

            // Aggregate across queries by key (keep best score, add small boosts for repeat hits and higher ranks)
            type Agg = { sample: typeof allItems[number]; urlKey: string; bestScore: number; bestRank: number; hits: number }
            const agg = new Map<string, Agg>()
            for (const item of allItems) {
              let key: string
              let urlKey: string
              try {
                const u2 = new URL(item.url)
                u2.search = ''
                u2.hash = ''
                key = item.source_type === 'social' ? `${u2.protocol}//${u2.host}${u2.pathname}` : `${u2.protocol}//${u2.host}`
                urlKey = key
              } catch {
                key = item.url
                urlKey = item.url
              }
              const a = agg.get(key)
              if (!a) {
                agg.set(key, { sample: item, urlKey, bestScore: item.score || 0, bestRank: item.rank || 999, hits: 1 })
              } else {
                a.hits += 1
                a.bestScore = Math.max(a.bestScore, item.score || 0)
                a.bestRank = Math.min(a.bestRank, item.rank || 999)
                if ((item.score || 0) > (a.sample.score || 0)) a.sample = item
              }
            }
            const urlsPre: typeof allItems = []
            for (const a of agg.values()) {
              const dupBoostRaw = Math.min(6, Math.max(0, (a.hits - 1) * 2))
              const rankBoostRaw = Math.max(0, 6 - Math.max(0, (a.bestRank - 1)))
              const scale = a.bestScore >= 40 ? 1 : a.bestScore >= 30 ? 0.5 : 0
              const finalScore = Math.round(a.bestScore + scale * (dupBoostRaw + rankBoostRaw))
              urlsPre.push({ ...a.sample, url: a.urlKey, score: finalScore })
            }
            // Per-host cap (max 4)
            const CAP = 4
            const urls: typeof allItems = []
            const perHost: Record<string, number> = {}
            // sort by score desc to keep best first
            urlsPre.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            for (const it of urlsPre) {
              const h = it.host
              const n = perHost[h] || 0
              if (n < CAP) {
                urls.push(it)
                perHost[h] = n + 1
              }
            }

            const snapshot = { provider: 'searxng', queries, urls, capturedAt: new Date().toISOString() }
            if (auditId) {
              await supabase
                .from('business_snapshots')
                .insert({ business_id: businessId, audit_id: auditId, source: 'manual', data: { discovery: snapshot } })
              send('snapshot:saved', { auditId, count: urls.length })
            }
            send('done', { total: urls.length })
            controller.close()
          })().catch(err => {
            send('fatal', { error: err?.message || 'unknown' })
            controller.close()
          })
        }
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        }
      })
    }

    // Non-streaming mode (existing behavior) with timeouts and minimal diagnostics
    const engines = process.env.SEARXNG_ENGINES || 'bing,brave,duckduckgo,mojeek'
    const perQueryLimit = parseInt(process.env.SEARXNG_PER_QUERY_LIMIT || '5', 10)
    const delayMs = parseInt(process.env.SEARXNG_QUERY_DELAY_MS || '800', 10)
    let searxItems = 0

    // Deterministic AU directory probes via Serper (site-restricted)
    try {
      const probeResults = await runDirectoryProbes({ name: bp.golden_name, address: bp.golden_address, limitPerHost: 2 })
      for (const p of probeResults) {
        const h = p.host || hostOf(p.url)
        if (!h) continue
        const type = classifyHost(h)
        const baseItem = { url: p.url, title: p.title, content: p.snippet, host: h, source_type: type as any }
        const { score } = scoreItem(baseItem)
        allItems.push({ ...baseItem, score, rank: 1 })
      }
    } catch { /* ignore probe errors */ }
    for (const q of queries) {
      const u = new URL('/search', searx)
      u.searchParams.set('q', q)
      u.searchParams.set('format', 'json')
      u.searchParams.set('safesearch', '0')
      u.searchParams.set('language', 'en-AU')
      u.searchParams.set('limit', String(perQueryLimit))
      if (engines) u.searchParams.set('engines', engines)
      const target = u.toString()
      const { res } = await fetchWithTimeout(target, 10000).catch(() => ({ res: null as any }))
      if (!res || !res.ok) continue
      const data = await res.json().catch(() => ({} as any))
      const results: any[] = Array.isArray(data?.results) ? data.results : []
      let idx = 0
      let emitted = 0
      for (const r of results) {
        idx++
        if (!r?.url || typeof r.url !== 'string') continue
        // Exclude only exact normalized website URL
        try {
          const u0 = new URL(r.url)
          u0.search = ''
          u0.hash = ''
          const norm = `${u0.protocol}//${u0.host}${u0.pathname || '/'}`
          const normSlash = norm.endsWith('/') ? norm : `${norm}/`
          if (websiteNormalized && (normSlash === websiteNormalized)) continue
        } catch { continue }
        const host = hostOf(r.url)
        if (!host) continue
        const type = classifyHost(host)
        const baseItem = { url: r.url, title: r.title, content: r.content, host, source_type: type as any }
        const { score } = scoreItem(baseItem)
        allItems.push({ ...baseItem, score, rank: idx })
        emitted++
      }
      searxItems += emitted
      await new Promise(r => setTimeout(r, delayMs))
    }

    // Optional: Serper fallback when SearXNG produced zero items
    try {
      const SERPER_KEY = process.env.SERPER_API_KEY
      if (SERPER_KEY && searxItems === 0) {
        const qFallbacks = queries.slice(0, 2)
        for (const q of qFallbacks) {
          const body = { q, gl: 'au', hl: 'en', autocorrect: true, num: perQueryLimit }
          try {
            const r2 = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
              body: JSON.stringify(body),
              cache: 'no-store'
            })
            if (!r2.ok) continue
            const data2: any = await r2.json().catch(() => ({} as any))
            const organic: any[] = Array.isArray(data2?.organic) ? data2.organic : []
            let idx = 0
            for (const r of organic) {
              idx++
              const url = r?.link
              if (!url || typeof url !== 'string') continue
              try {
                const u0 = new URL(url)
                u0.search = ''
                u0.hash = ''
                const norm = `${u0.protocol}//${u0.host}${u0.pathname || '/'}`
                const normSlash = norm.endsWith('/') ? norm : `${norm}/`
                if (websiteNormalized && (normSlash === websiteNormalized)) continue
              } catch { continue }
              const host = hostOf(url)
              if (!host) continue
              const type = classifyHost(host)
              const baseItem = { url, title: r.title, content: r.snippet, host, source_type: type as any }
              const { score } = scoreItem(baseItem)
              allItems.push({ ...baseItem, score, rank: idx })
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* noop */ }

    // Aggregate across queries by key (keep best score, add small boosts for repeat hits and higher ranks)
    type Agg = { sample: typeof allItems[number]; urlKey: string; bestScore: number; bestRank: number; hits: number }
    const agg = new Map<string, Agg>()
    for (const item of allItems) {
      let key: string
      let urlKey: string
      try {
        const u = new URL(item.url)
        u.search = ''
        u.hash = ''
        key = item.source_type === 'social' ? `${u.protocol}//${u.host}${u.pathname}` : `${u.protocol}//${u.host}`
        urlKey = key
      } catch {
        key = item.url
        urlKey = item.url
      }
      const a = agg.get(key)
      if (!a) {
        agg.set(key, { sample: item, urlKey, bestScore: item.score || 0, bestRank: item.rank || 999, hits: 1 })
      } else {
        a.hits += 1
        a.bestScore = Math.max(a.bestScore, item.score || 0)
        a.bestRank = Math.min(a.bestRank, item.rank || 999)
        if ((item.score || 0) > (a.sample.score || 0)) a.sample = item
      }
    }
    const urlsPre: typeof allItems = []
    for (const a of agg.values()) {
      const dupBoostRaw = Math.min(6, Math.max(0, (a.hits - 1) * 2))
      const rankBoostRaw = Math.max(0, 6 - Math.max(0, (a.bestRank - 1)))
      const scale = a.bestScore >= 40 ? 1 : a.bestScore >= 30 ? 0.5 : 0
      const finalScore = Math.round(a.bestScore + scale * (dupBoostRaw + rankBoostRaw))
      urlsPre.push({ ...a.sample, url: a.urlKey, score: finalScore })
    }
    // Per-host cap (max 4)
    const CAP = 4
    const urls: typeof allItems = []
    const perHost: Record<string, number> = {}
    urlsPre.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    for (const it of urlsPre) {
      const h = it.host
      const n = perHost[h] || 0
      if (n < CAP) {
        urls.push(it)
        perHost[h] = n + 1
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
