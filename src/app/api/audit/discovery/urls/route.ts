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

function buildFacebookQueries(input: { name?: string|null; cityGuess?: string|null; state?: string|null }) {
  const { name, cityGuess, state } = input
  const vname = (name || '')
  const noApos = vname.replace(/[’']/g, '')
  const simple = normalizeSimple(noApos)
  const variants = new Set<string>([vname, noApos, simple])
  const queries: string[] = []
  const hosts = ['facebook.com', 'm.facebook.com']
  for (const h of hosts) {
    for (const nm of Array.from(variants).filter(Boolean).slice(0, 2)) {
      if (cityGuess) queries.push(`site:${h} "${nm}" ${cityGuess}`)
      if (state) queries.push(`site:${h} "${nm}" ${state}`)
      queries.push(`site:${h} "${nm}"`)
    }
  }
  return Array.from(new Set(queries))
}
function classifyHost(host: string): 'social'|'directory'|'places'|'web' {
  const matchDomain = (h: string, d: string) => h === d || h.endsWith(`.${d}`)
  if (KNOWN_MAPS.some(d => matchDomain(host, d)) || /google\.[^/]*\/maps/i.test(host)) return 'places'
  if (KNOWN_SOCIAL.some(d => matchDomain(host, d))) return 'social'
  if (KNOWN_DIRECTORIES.some(d => matchDomain(host, d))) return 'directory'
  return 'web'
}

// --- Fuzzy helpers ---
function stripDiacritics(s: string): string {
  try { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') } catch { return s }
}
function normalizeSimple(s?: string|null): string {
  return stripDiacritics((s||'').toLowerCase()).replace(/[^a-z0-9\s&-]/g, ' ').replace(/\s+/g, ' ').trim()
}
function generateNameVariants(name?: string|null): string[] {
  const base = normalizeSimple(name)
  if (!base) return []
  const variants = new Set<string>()
  variants.add(base)
  // no apostrophes/hyphens already handled by normalizeSimple punctuation removal
  const ampToAnd = base.replace(/\s*&\s*/g, ' and ')
  variants.add(ampToAnd)
  const hyphToSpace = base.replace(/-/g, ' ')
  variants.add(hyphToSpace)
  const noSpaces = base.replace(/\s+/g, '')
  variants.add(noSpaces)
  return Array.from(variants).filter(v => v)
}
// Bounded Damerau-Levenshtein distance with early exit (good for short tokens)
function dlDistance(a: string, b: string, maxDist = 2): number {
  if (a === b) return 0
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > maxDist) return maxDist + 1
  if (la === 0 || lb === 0) return Math.max(la, lb)
  const INF = la + lb
  const da: Record<string, number> = {}
  const max = Math.max(la, lb)
  const d: number[][] = Array.from({ length: la + 2 }, () => new Array(lb + 2).fill(0))
  d[0][0] = INF
  for (let i = 0; i <= la; i++) { d[i+1][1] = i; d[i+1][0] = INF }
  for (let j = 0; j <= lb; j++) { d[1][j+1] = j; d[0][j+1] = INF }
  for (let i = 1; i <= la; i++) {
    let db = 0
    for (let j = 1; j <= lb; j++) {
      const i1 = da[b[j-1]] || 0
      const j1 = db
      let cost = 1
      if (a[i-1] === b[j-1]) { cost = 0; db = j }
      d[i+1][j+1] = Math.min(
        d[i][j] + cost,             // substitution
        d[i+1][j] + 1,               // insertion
        d[i][j+1] + 1,               // deletion
        d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1) // transposition
      )
    }
    da[a[i-1]] = i
    // early exit band check
    if (Math.min(...d[i+1].slice(1, lb+2)) > maxDist) return maxDist + 1
  }
  return d[la+1][lb+1]
}

function buildQueries(input: { name?: string|null; address?: string|null; phone?: string|null; websiteHost?: string|null; cityGuess?: string|null; }) {
  const q: string[] = []
  const { name, address, phone, websiteHost, cityGuess } = input
  const nameNoApos = name ? name.replace(/[’']/g, '') : null
  const nameVariants = generateNameVariants(name)
  const phoneDigits = (phone || '').replace(/\D/g, '')
  const state = stateFromAddress(address)
  const postcode = postcodeFromAddress(address)
  if (name && phoneDigits) q.push(`"${name}" ${phoneDigits}`)
  if (name && address) q.push(`"${name}" ${address}`)
  if (name && cityGuess) q.push(`"${name}" ${cityGuess}`)
  if (name && cityGuess && state) q.push(`"${name}" ${cityGuess} ${state}`)
  if (name && cityGuess) q.push(`${name} ${cityGuess} site:.au`)
  if (name && state) q.push(`${name} ${state} site:.au`)
  // Apostrophe-less variants to catch queries like "heiners bakery"
  if (nameNoApos && nameNoApos !== name) {
    q.push(`"${nameNoApos}"`)
    if (cityGuess) q.push(`"${nameNoApos}" ${cityGuess}`)
    if (state) q.push(`${nameNoApos} ${state} site:.au`)
  }
  // Additional fuzzy name variants (limited to avoid explosion)
  for (const v of nameVariants.slice(0, 2)) { // only first two variants
    if (v !== normalizeSimple(name || '')) {
      if (cityGuess) q.push(`"${v}" ${cityGuess}`)
      else q.push(`"${v}"`)
    }
  }
  // Phone-only broad queries (web + AU bias)
  if (phoneDigits) {
    q.push(`${phoneDigits}`)
    q.push(`${phoneDigits} site:.au`)
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
    if (nameNoApos && nameNoApos !== name) {
      if (cityGuess) q.push(`site:${d} "${nameNoApos}" ${cityGuess}`)
      q.push(`site:${d} "${nameNoApos}"`)
    }
    // a couple of fuzzy variants for social hosts
    for (const v of nameVariants.slice(0, 1)) {
      if (v) {
        if (cityGuess) q.push(`site:${d} "${v}" ${cityGuess}`)
        q.push(`site:${d} "${v}"`)
      }
    }
    if (phoneDigits) q.push(`site:${d} ${phoneDigits}`)
    if (address) {
      const firstLine = address.split(',')[0]?.trim()
      if (firstLine) q.push(`site:${d} "${firstLine}"`)
    }
  }
  for (const d of KNOWN_DIRECTORIES) {
    if (name && cityGuess) q.push(`site:${d} "${name}" ${cityGuess}`)
    if (name) q.push(`site:${d} "${name}"`)
    if (phoneDigits) q.push(`site:${d} ${phoneDigits}`)
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

    // --- Tunables (env) for scoring and aggregation ---
    const FUZZY_NAME_MAX_BONUS = parseInt(process.env.FUZZY_NAME_MAX_BONUS || '6', 10)
    const MIN_ITEM_SCORE_DEFAULT = parseInt(process.env.MIN_ITEM_SCORE || '16', 10)
    const MIN_ITEM_SCORE_SOCIAL = parseInt(process.env.MIN_ITEM_SCORE_SOCIAL || String(MIN_ITEM_SCORE_DEFAULT), 10)
    const MIN_ITEM_SCORE_DIRECTORY = parseInt(process.env.MIN_ITEM_SCORE_DIRECTORY || String(MIN_ITEM_SCORE_DEFAULT), 10)
    const MIN_ITEM_SCORE_PLACES = parseInt(process.env.MIN_ITEM_SCORE_PLACES || String(MIN_ITEM_SCORE_DEFAULT), 10)
    const MIN_ITEM_SCORE_WEB = parseInt(process.env.MIN_ITEM_SCORE_WEB || String(MIN_ITEM_SCORE_DEFAULT), 10)

    const CAP_DEFAULT = parseInt(process.env.PER_HOST_CAP_DEFAULT || '4', 10)
    const CAP_SOCIAL = parseInt(process.env.PER_HOST_CAP_SOCIAL || String(CAP_DEFAULT), 10)
    const CAP_DIRECTORY = parseInt(process.env.PER_HOST_CAP_DIRECTORY || String(CAP_DEFAULT), 10)
    const CAP_PLACES = parseInt(process.env.PER_HOST_CAP_PLACES || String(CAP_DEFAULT), 10)
    const CAP_WEB = parseInt(process.env.PER_HOST_CAP_WEB || String(CAP_DEFAULT), 10)

    const parseHostOverrides = (s?: string|null): Record<string, number> => {
      const out: Record<string, number> = {}
      if (!s) return out
      for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
        const [k, v] = part.split(/[=:\s]/)
        const n = parseInt((v||'').trim(), 10)
        if (k && Number.isFinite(n)) out[k.trim()] = n
      }
      return out
    }
    const HOST_CAP_OVERRIDES = parseHostOverrides(process.env.HOST_CAP_OVERRIDES)

    const minScoreFor = (t: 'social'|'directory'|'places'|'web') => (
      t === 'social' ? MIN_ITEM_SCORE_SOCIAL :
      t === 'directory' ? MIN_ITEM_SCORE_DIRECTORY :
      t === 'places' ? MIN_ITEM_SCORE_PLACES :
      MIN_ITEM_SCORE_WEB
    )
    const capFor = (host: string, t: 'social'|'directory'|'places'|'web') => (
      HOST_CAP_OVERRIDES[host] ?? (
        t === 'social' ? CAP_SOCIAL :
        t === 'directory' ? CAP_DIRECTORY :
        t === 'places' ? CAP_PLACES :
        CAP_WEB
      )
    )

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
    const isJobBoard = (host: string) => JOB_BOARD_HOSTS.some(d => host === d || host.endsWith(`.${d}`))
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

        // Fuzzy token boosts: near-miss brand tokens in title/path/content
        const combinedTokens = Array.from(new Set<string>([...titleT, ...pathT, ...contentT]))
        let fuzzyScore = 0
        for (const bt of brandTokens) {
          if (combinedTokens.includes(bt)) continue
          let best = Infinity
          for (const ct of combinedTokens) {
            // skip very short tokens for fuzzy to avoid noise
            if (ct.length <= 2 || bt.length <= 2) continue
            const md = dlDistance(bt, ct, 2)
            if (md < best) best = md
            if (best === 0) break
          }
          if (bt.length >= 4 && best === 1) fuzzyScore += 2
          else if (bt.length >= 6 && best === 2) fuzzyScore += 1
        }
        fuzzyScore = Math.min(fuzzyScore, FUZZY_NAME_MAX_BONUS)
        tokenScore += fuzzyScore

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

      // Facebook-specific heuristics: demote low-value content types and require geo support
      if (item.host === 'facebook.com' || item.host === 'm.facebook.com') {
        const p = urlObj.pathname.toLowerCase()
        const fbIsGroup = /\/groups\//.test(p)
        const fbIsReel = /\/(reel|reels|watch)\//.test(p)
        const fbIsPost = /\/posts?\//.test(p) || /\/permalink\//.test(p) || /\/story\.php/.test(p)
        const fbIsProfile = /\/people\//.test(p) || /\/profile\.php/.test(p)
        const fbLowValue = fbIsGroup || fbIsReel || fbIsPost || fbIsProfile

        // Demote low-value FB content unless strong supporting signals are present
        if (fbLowValue && strongSupportCount === 0) {
          score -= 12
          score = Math.min(score, 18)
        }

        // Stronger wrong-geo guard on Facebook: if no geo support, penalize and cap a bit
        if (!hasGeo) {
          score -= 6
          score = Math.min(score, 22)
        }

        // Small bonus for likely business pages (short slug or /pages/ paths)
        const segs = p.split('/').filter(Boolean)
        const fbLikelyPage = (!fbLowValue && (segs.length === 1 || p.startsWith('/pages/')))
        if (fbLikelyPage) score += 2
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
            const SERPER_PARALLEL = (process.env.SERPER_PARALLEL || '').toLowerCase() === 'true' || process.env.SERPER_PARALLEL === '1'
            const SERPER_PARALLEL_MAX_QUERIES = parseInt(process.env.SERPER_PARALLEL_MAX_QUERIES || '3', 10)
            const SERPER_KEY_ENV = process.env.SERPER_API_KEY
            const SERPER_GL = process.env.SERPER_GL || 'au'
            const SERPER_HL = process.env.SERPER_HL || 'en'
            const SOCIAL_SERPER_FORCE = (process.env.SOCIAL_SERPER_FORCE || '').toLowerCase() === 'true' || process.env.SOCIAL_SERPER_FORCE === '1'
            const SOCIAL_SERPER_PER_QUERY = parseInt(process.env.SOCIAL_SERPER_PER_QUERY || '10', 10)
            const SOCIAL_SERPER_MAX_QUERY_COUNT = parseInt(process.env.SOCIAL_SERPER_MAX_QUERY_COUNT || '3', 10)
            send('meta', { provider: 'searxng', searx, engines, queries, limits: { perQueryLimit, delayMs }, serperParallel: SERPER_PARALLEL, serperMaxQueries: SERPER_PARALLEL_MAX_QUERIES })
            let searxItems = 0

            // Parallel Serper enrichment task (optional)
            async function runSerperEnrichment() {
              if (!SERPER_KEY_ENV || !SERPER_PARALLEL) return
              try {
                send('meta', { provider: 'serper', reason: 'parallel', maxQueries: SERPER_PARALLEL_MAX_QUERIES })
                // Prioritize a Facebook site query to better capture social presence
                const goldenName = bp?.golden_name || ''
                const nameNoApos2 = goldenName ? goldenName.replace(/[’']/g, '') : ''
                const socialsPriority: string[] = []
                if (nameNoApos2) {
                  socialsPriority.push(cityGuess ? `site:facebook.com "${nameNoApos2}" ${cityGuess}` : `site:facebook.com "${nameNoApos2}"`)
                }
                const qEnrich = Array.from(new Set([...socialsPriority, ...queries])).slice(0, SERPER_PARALLEL_MAX_QUERIES)
                for (const q of qEnrich) {
                  const body = { q, gl: SERPER_GL, hl: SERPER_HL, autocorrect: true, num: perQueryLimit }
                  send('query:start', { provider: 'serper', q, mode: 'parallel' })
                  const started = Date.now()
                  try {
                    const r2 = await fetch('https://google.serper.dev/search', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY_ENV },
                      body: JSON.stringify(body),
                      cache: 'no-store'
                    })
                    const elapsed = Date.now() - started
                    if (!r2.ok) {
                      send('query:error', { provider: 'serper', q, status: r2.status, elapsed, mode: 'parallel' })
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
                      send('query:done', { provider: 'serper', q, elapsed, count: emitted, total: organic.length, badUrl, excludedOwn, mode: 'parallel' })
                    }
                  } catch (e: any) {
                    send('query:error', { provider: 'serper', q, error: e?.message || 'fetch_failed', mode: 'parallel' })
                  }
                }
                send('serper:parallel:done', { queries: SERPER_PARALLEL_MAX_QUERIES })
              } catch { /* ignore */ }
            }
            const serperTask = runSerperEnrichment()

            // Forced Facebook-focused Serper queries (optional but independent)
            async function runSerperFacebook() {
              if (!SERPER_KEY_ENV || !SOCIAL_SERPER_FORCE) return
              try {
                const fbQueries = buildFacebookQueries({ name: bp?.golden_name, cityGuess, state: expectedState }).slice(0, SOCIAL_SERPER_MAX_QUERY_COUNT)
                send('meta', { provider: 'serper', reason: 'forced_social', host: 'facebook.com', count: fbQueries.length })
                for (const q of fbQueries) {
                  const body = { q, gl: SERPER_GL, hl: SERPER_HL, autocorrect: true, num: SOCIAL_SERPER_PER_QUERY }
                  send('query:start', { provider: 'serper', q, mode: 'forced_social' })
                  const started = Date.now()
                  try {
                    const r2 = await fetch('https://google.serper.dev/search', {
                      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY_ENV }, body: JSON.stringify(body), cache: 'no-store'
                    })
                    const elapsed = Date.now() - started
                    if (!r2.ok) {
                      send('query:error', { provider: 'serper', q, status: r2.status, elapsed, mode: 'forced_social' })
                    } else {
                      const data2: any = await r2.json().catch(() => ({} as any))
                      const organic: any[] = Array.isArray(data2?.organic) ? data2.organic : []
                      let emitted = 0, badUrl = 0, excludedOwn = 0, idx = 0
                      for (const r of organic) {
                        idx++
                        const url = r?.link
                        if (!url || typeof url !== 'string') { badUrl++; continue }
                        try {
                          const u0 = new URL(url); u0.search = ''; u0.hash = ''
                          const norm = `${u0.protocol}//${u0.host}${u0.pathname || '/'}`
                          const normSlash = norm.endsWith('/') ? norm : `${norm}/`
                          if (websiteNormalized && (normSlash === websiteNormalized)) { excludedOwn++; continue }
                        } catch { badUrl++; continue }
                        const host = hostOf(url); if (!host) { badUrl++; continue }
                        const type = classifyHost(host)
                        const baseItem = { url, title: r.title, content: r.snippet, host, source_type: type as any }
                        const { score, exact, bigram, phone, geo, wrongLocation, occupationOnly, jobBoard } = scoreItem(baseItem)
                        const item = { ...baseItem, score, rank: idx, exact, bigram, phone, geo, wrongLocation, occupationOnly, jobBoard }
                        allItems.push(item)
                        send('item', item)
                        emitted++
                      }
                      send('query:done', { provider: 'serper', q, elapsed, count: emitted, total: organic.length, badUrl, excludedOwn, mode: 'forced_social' })
                    }
                  } catch (e: any) {
                    send('query:error', { provider: 'serper', q, error: e?.message || 'fetch_failed', mode: 'forced_social' })
                  }
                }
                send('serper:forced_social:done', { host: 'facebook.com' })
              } catch { /* ignore */ }
            }
            const serperFbTask = runSerperFacebook()

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

            // Optional: Serper fallback when SearXNG produced too few items
            try {
              const SERPER_KEY = process.env.SERPER_API_KEY
              const perQueryLimit = parseInt(process.env.SEARXNG_PER_QUERY_LIMIT || '5', 10)
              const FALLBACK_MIN = parseInt(process.env.SERPER_MIN_RESULTS || '3', 10)
              if (SERPER_KEY && searxItems < FALLBACK_MIN) {
                send('meta', { provider: 'serper', reason: 'fallback_threshold', threshold: FALLBACK_MIN, searxItems })
                // Include a Facebook site query in fallback attempts
                const goldenNameF = bp?.golden_name || ''
                const nameNoAposF = goldenNameF ? goldenNameF.replace(/[’']/g, '') : ''
                const fbPref = nameNoAposF ? [cityGuess ? `site:facebook.com "${nameNoAposF}" ${cityGuess}` : `site:facebook.com "${nameNoAposF}"`] : []
                const qFallbacks = Array.from(new Set([...fbPref, ...queries])).slice(0, 2) // keep it tight
                for (const q of qFallbacks) {
                  const gl = process.env.SERPER_GL || 'au'
                  const hl = process.env.SERPER_HL || 'en'
                  const body = { q, gl, hl, autocorrect: true, num: perQueryLimit }
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

            // Ensure parallel Serper enrichment has completed before aggregation
            await Promise.allSettled([serperTask, serperFbTask])

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
            // Per-host caps and per-type thresholds
            const urls: typeof allItems = []
            const perHost: Record<string, number> = {}
            const preFiltered = urlsPre.filter(it => (it.score ?? 0) >= minScoreFor(it.source_type))
            send('aggregate:pre', {
              aggCandidates: agg.size,
              preFiltered: preFiltered.length,
              minScoreDefault: MIN_ITEM_SCORE_DEFAULT,
              minScoreByType: { social: MIN_ITEM_SCORE_SOCIAL, directory: MIN_ITEM_SCORE_DIRECTORY, places: MIN_ITEM_SCORE_PLACES, web: MIN_ITEM_SCORE_WEB }
            })
            // sort by score desc to keep best first
            preFiltered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            let capDropped = 0
            for (const it of preFiltered) {
              const h = it.host
              const n = perHost[h] || 0
              const cap = capFor(h, it.source_type)
              if (n < cap) {
                urls.push(it)
                perHost[h] = n + 1
              } else {
                capDropped++
              }
            }
            send('aggregate:post', {
              kept: urls.length,
              capDefault: CAP_DEFAULT,
              capByType: { social: CAP_SOCIAL, directory: CAP_DIRECTORY, places: CAP_PLACES, web: CAP_WEB },
              hostOverrides: HOST_CAP_OVERRIDES,
              capDropped
            })

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
    const engines = process.env.SEARXNG_ENGINES || 'google,bing,brave,duckduckgo,mojeek'
    const perQueryLimit = parseInt(process.env.SEARXNG_PER_QUERY_LIMIT || '5', 10)
    const delayMs = parseInt(process.env.SEARXNG_QUERY_DELAY_MS || '800', 10)
    const SERPER_PARALLEL = (process.env.SERPER_PARALLEL || '').toLowerCase() === 'true' || process.env.SERPER_PARALLEL === '1'
    const SERPER_PARALLEL_MAX_QUERIES = parseInt(process.env.SERPER_PARALLEL_MAX_QUERIES || '3', 10)
    const SERPER_KEY_ENV = process.env.SERPER_API_KEY
    const SERPER_GL = process.env.SERPER_GL || 'au'
    const SERPER_HL = process.env.SERPER_HL || 'en'
    let searxItems = 0

    // Optional: fire Serper enrichment in parallel (non-streaming)
    async function runSerperEnrichmentNS() {
      if (!SERPER_KEY_ENV || !SERPER_PARALLEL) return
      try {
        // Prioritize a Facebook site query to better capture social presence
        const goldenNameNS = bp?.golden_name || ''
        const nameNoApos2 = goldenNameNS ? goldenNameNS.replace(/[’']/g, '') : ''
        const socialsPriority: string[] = []
        if (nameNoApos2) {
          socialsPriority.push(cityGuess ? `site:facebook.com "${nameNoApos2}" ${cityGuess}` : `site:facebook.com "${nameNoApos2}"`)
        }
        const qEnrich = Array.from(new Set([...socialsPriority, ...queries])).slice(0, SERPER_PARALLEL_MAX_QUERIES)
        for (const q of qEnrich) {
          const body = { q, gl: SERPER_GL, hl: SERPER_HL, autocorrect: true, num: perQueryLimit }
          try {
            const r2 = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY_ENV },
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
      } catch { /* ignore */ }
    }
    const serperTaskNS = runSerperEnrichmentNS()

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

    // Optional: Serper fallback when SearXNG produced too few items
    try {
      const SERPER_KEY = process.env.SERPER_API_KEY
      const FALLBACK_MIN = parseInt(process.env.SERPER_MIN_RESULTS || '3', 10)
      if (SERPER_KEY && searxItems < FALLBACK_MIN) {
        // Include a Facebook site query in fallback attempts
        const goldenNameF = bp?.golden_name || ''
        const nameNoAposF = goldenNameF ? goldenNameF.replace(/[’']/g, '') : ''
        const fbPref = nameNoAposF ? [cityGuess ? `site:facebook.com "${nameNoAposF}" ${cityGuess}` : `site:facebook.com "${nameNoAposF}"`] : []
        const qFallbacks = Array.from(new Set([...fbPref, ...queries])).slice(0, 2)
        for (const q of qFallbacks) {
          const body = { q, gl: SERPER_GL, hl: SERPER_HL, autocorrect: true, num: perQueryLimit }
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

    // Ensure parallel Serper enrichment has completed before aggregation
    await serperTaskNS.catch(() => {})

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
    // Per-host caps and per-type thresholds
    const urls: typeof allItems = []
    const perHost: Record<string, number> = {}
    const preFiltered = urlsPre.filter(it => (it.score ?? 0) >= minScoreFor(it.source_type))
    preFiltered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    for (const it of preFiltered) {
      const h = it.host
      const n = perHost[h] || 0
      const cap = capFor(h, it.source_type)
      if (n < cap) {
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
