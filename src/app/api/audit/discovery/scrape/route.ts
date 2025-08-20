import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AU_DIRECTORIES, AU_DIRECTORY_HOSTS, AU_SOCIAL_HOSTS, AU_MAPS_PLACES_HOSTS, DirectoryDef } from '@/lib/discovery/au_directories'

function hostOf(u: string): string | null { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }

function extractLastPostAt(html: string): string | null {
  const candidates: number[] = []
  // <time datetime="...">
  const timeTagRe = /<time[^>]*datetime=["']([^"']+)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = timeTagRe.exec(html))) {
    const ts = Date.parse(m[1])
    if (!isNaN(ts)) candidates.push(ts)
  }
  // meta property/name published_time/date
  const metaTimeRe = /<meta[^>]*(?:property|name)=["'](?:article:published_time|og:updated_time|published_time|date|dc\.date)["'][^>]*content=["']([^"']+)["'][^>]*>/gi
  while ((m = metaTimeRe.exec(html))) {
    const ts = Date.parse(m[1])
    if (!isNaN(ts)) candidates.push(ts)
  }
  // Facebook data-utime (unix seconds or ms)
  const utimeRe = /data-utime=["'](\d{9,13})["']/gi
  while ((m = utimeRe.exec(html))) {
    const num = Number(m[1])
    const ts = num > 1e12 ? num : num * 1000
    if (!isNaN(ts)) candidates.push(ts)
  }
  if (!candidates.length) return null
  const max = Math.max(...candidates)
  return new Date(max).toISOString()
}

function detectSocialKey(u: string): string | null {
  try {
    const h = new URL(u).hostname.replace(/^www\./, '')
    if (h.includes('facebook.com')) return 'facebook'
    if (h.includes('instagram.com')) return 'instagram'
    if (h.includes('linkedin.com')) return 'linkedin'
    if (h.includes('x.com') || h.includes('twitter.com')) return 'x'
    if (h.includes('youtube.com') || h.includes('youtu.be')) return 'youtube'
    if (h.includes('tiktok.com')) return 'tiktok'
    return null
  } catch { return null }
}
function classifyHost(host: string): 'social'|'directory'|'places'|'web' {
  if (AU_MAPS_PLACES_HOSTS.some(h => host.endsWith(h)) || /google\.[^/]*\/maps/i.test(host)) return 'places'
  if (AU_SOCIAL_HOSTS.some(h => host.endsWith(h))) return 'social'
  if (AU_DIRECTORY_HOSTS.some(h => host.endsWith(h))) return 'directory'
  return 'web'
}
function findDirectoryByHost(host: string): DirectoryDef | null {
  for (const d of AU_DIRECTORIES) {
    if (d.hosts.some(h => host.endsWith(h))) return d
  }
  return null
}

function normalizePhoneAU(input?: string | null): string | null {
  if (!input) return null
  const digits = ('' + input).replace(/[^\d]/g, '')
  if (!digits) return null
  if (digits.startsWith('61')) return '+61' + digits.slice(2)
  if (digits.startsWith('0')) return '+61' + digits.slice(1)
  if (digits.startsWith('1') && digits.length >= 8) return digits // service numbers (e.g. 13/1300/1800)
  if (digits.startsWith('4') && digits.length === 9) return '+61' + digits // mobiles without leading 0
  return '+' + digits // fallback
}

function tokenSet(s?: string | null): Set<string> {
  if (!s) return new Set()
  return new Set((s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)))
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const denom = Math.min(a.size, b.size)
  return inter / (denom || 1)
}

function scoreMatch({ golden, obs }: { golden: { name?: string|null, address?: string|null, phone?: string|null }, obs: { name?: string|null, address?: string|null, phone?: string|null } }) {
  let score = 0
  const mismatch: Record<string, any> = {}

  const gPhone = normalizePhoneAU(golden.phone)
  const oPhone = normalizePhoneAU(obs.phone)
  let phoneMatch = false
  if (gPhone && oPhone) {
    if (gPhone === oPhone || (gPhone.endsWith(oPhone) || oPhone.endsWith(gPhone))) { score += 60; phoneMatch = true }
    else mismatch.phone = { golden: gPhone, observed: oPhone }
  } else if (gPhone || oPhone) {
    mismatch.phone = { golden: gPhone, observed: oPhone }
  }

  const gAddrTokens = tokenSet(golden.address)
  const oAddrTokens = tokenSet(obs.address)
  const addrOverlap = overlapRatio(gAddrTokens, oAddrTokens)
  const addressMatch = addrOverlap >= 0.6
  if (addressMatch) score += 30
  else if (addrOverlap > 0) mismatch.address = { overlap: addrOverlap, golden: golden.address, observed: obs.address }

  const gName = tokenSet(golden.name)
  const oName = tokenSet(obs.name)
  const nameOverlap = overlapRatio(gName, oName)
  const nameMatch = nameOverlap >= 0.6
  if (nameMatch) score += 10
  else if (nameOverlap > 0) mismatch.name = { overlap: nameOverlap, golden: golden.name, observed: obs.name }

  const flags = { phone: phoneMatch, address: addressMatch, name: nameMatch }
  return { score: Math.round(score), mismatch, flags }
}

function extractBetween(html: string, re: RegExp): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.push(m[1])
  return out
}
function tryParseJson<T = any>(s: string): T | null { try { return JSON.parse(s) } catch { return null } }

function extractFromHtml(html: string) {
  // Basic signals
  const nameFromTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null

  const jsonLdScripts = extractBetween(html, /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  const jsonLd: any[] = []
  for (const s of jsonLdScripts.slice(0, 5)) {
    const obj = tryParseJson(s)
    if (!obj) continue
    if (Array.isArray(obj)) jsonLd.push(...obj)
    else jsonLd.push(obj)
  }

  const localBusiness: any[] = []
  for (const item of jsonLd) {
    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']].filter(Boolean)
    if (types.some((t: string) => /LocalBusiness|Organization/i.test(t))) localBusiness.push(item)
  }

  const phones: string[] = []
  extractBetween(html, /href=["']tel:([^"']+)["']/gi).forEach(v => phones.push(v))
  const reAu = /(\+61\s?\d[\d\s-]{7,12}|0\d[\d\s-]{7,10})/g
  let m: RegExpExecArray | null
  while ((m = reAu.exec(html))) phones.push(m[1])

  const addresses: string[] = []
  for (const lb of localBusiness) {
    const addr = lb.address
    if (addr && typeof addr === 'object') {
      const formatted = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry].filter(Boolean).join(', ')
      if (formatted) addresses.push(formatted)
    }
  }

  const names: string[] = []
  for (const lb of localBusiness) if (typeof lb.name === 'string') names.push(lb.name)
  if (nameFromTitle) names.push(nameFromTitle)

  return {
    names: Array.from(new Set(names)).slice(0, 5),
    addresses: Array.from(new Set(addresses)).slice(0, 5),
    phones: Array.from(new Set(phones)).slice(0, 5),
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; PageoneAuditBot/1.0)' },
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    })
    return res
  } finally {
    clearTimeout(t)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    let { businessId, auditId, urls, useDiscovery } = body || {}

    const supabase = createAdminClient()

    // Resolve businessId from auditId when only auditId is provided
    if (!businessId && auditId) {
      const { data: audit, error: auditErr } = await supabase
        .from('audit_runs')
        .select('id, business_id')
        .eq('id', auditId)
        .single()
      if (auditErr || !audit) return NextResponse.json({ ok: false, error: auditErr?.message || 'Audit not found' }, { status: 404 })
      businessId = audit.business_id
    }

    if (!businessId || !auditId) return NextResponse.json({ ok: false, error: 'Missing businessId or auditId' }, { status: 400 })

    const { data: bp, error: bpErr } = await supabase
      .from('business_profiles')
      .select('id, golden_name, golden_address, golden_phone, website, socials')
      .eq('business_id', businessId)
      .single()
    if (bpErr || !bp) return NextResponse.json({ ok: false, error: bpErr?.message || 'Business not found' }, { status: 404 })

    let targetUrls: string[] = Array.isArray(urls) ? urls : []
    // Track explicit URLs provided by the user to respect tick/untick intent
    const explicitSet = new Set<string>()
    for (const u of targetUrls) {
      try { const k = new URL(u); k.search=''; k.hash=''; const s = k.toString(); explicitSet.add(s.endsWith('/')?s:s+'/') } catch {}
    }

    if (useDiscovery && targetUrls.length === 0) {
      const { data: snap, error: snapErr } = await supabase
        .from('business_snapshots')
        .select('data, created_at')
        .eq('audit_id', auditId)
        .eq('source', 'manual')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!snapErr && snap?.data?.discovery?.urls) {
        targetUrls = snap.data.discovery.urls.map((x: any) => x.url).filter((u: string) => typeof u === 'string')
      }
    }

    // Do not auto-include the website; only include if user explicitly selected it via body.urls
    const socialsObj = (bp as any).socials && typeof (bp as any).socials === 'object' ? (bp as any).socials : {}
    for (const v of Object.values(socialsObj || {})) {
      if (typeof v === 'string') {
        try { const u0 = new URL(v); u0.search=''; u0.hash=''; targetUrls.push(`${u0.protocol}//${u0.host}${u0.pathname}`) } catch {}
      }
    }

    // Normalize website for exclusion unless explicitly provided
    const websiteNormalized = (() => {
      try {
        if (!(bp as any).website) return null
        const w = new URL((bp as any).website)
        w.search = ''
        w.hash = ''
        const s = `${w.protocol}//${w.host}${w.pathname || '/'}`
        return s.endsWith('/') ? s : `${s}/`
      } catch { return null }
    })()

    // Limit and de-dup
    const seen = new Set<string>()
    targetUrls = targetUrls.filter(u => {
      try {
        const key = new URL(u); key.search = ''; key.hash = '';
        const s0 = key.toString(); const s = s0.endsWith('/') ? s0 : `${s0}/`
        // Skip website unless it was explicitly provided by the user
        if (websiteNormalized && s === websiteNormalized && !explicitSet.has(s)) return false
        if (seen.has(s)) return false; seen.add(s); return true
      } catch { return false }
    }).slice(0, 80)

    // Scrape sequentially with light delay to reduce blocks
    const observations: Array<{ url: string, source_type: 'social'|'directory'|'web'|'places', name?: string|null, address?: string|null, phone?: string|null, match_score: number, mismatch: any, last_post_at?: string|null }> = []
    const socialsLast: Record<string, string> = {}
    // Buffer for incremental inserts to support live progress
    const buffer: Array<{ audit_id: string, business_id: string, source_url: string, source_type: string, name: string|null, address: string|null, phone: string|null, match_score: number, mismatch: any }> = []
    const flushBuffer = async () => {
      if (!buffer.length) return
      const batch = buffer.splice(0, buffer.length)
      const { error: insErr } = await supabase.from('nap_observations').insert(batch)
      if (insErr) throw new Error(insErr.message)
    }

    const WORKER_TIMEOUT_MS = parseInt(process.env.WORKER_TIMEOUT_MS || '10000', 10)

    for (const u of targetUrls) {
      const host = hostOf(u)
      const type = host ? classifyHost(host) : 'web'
      try {
        const res = await fetchWithTimeout(u, WORKER_TIMEOUT_MS)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const html = await res.text()
        const ext = extractFromHtml(html)
        const obs = {
          name: ext.names[0] || null,
          address: ext.addresses[0] || null,
          phone: ext.phones[0] || null,
        }
        const { score, mismatch, flags } = scoreMatch({ golden: { name: bp.golden_name, address: bp.golden_address, phone: bp.golden_phone }, obs })
        const mismatchJson = { ...mismatch, flags }
        let lastPostAt: string | null = null
        if (type === 'social') {
          lastPostAt = extractLastPostAt(html)
          const key = detectSocialKey(u)
          if (key && lastPostAt) {
            const prev = socialsLast[key]
            if (!prev || new Date(lastPostAt).getTime() > new Date(prev).getTime()) socialsLast[key] = lastPostAt
          }
        }
        observations.push({ url: u, source_type: type, ...obs, match_score: score, mismatch: mismatchJson, last_post_at: lastPostAt })
        buffer.push({
          audit_id: auditId,
          business_id: businessId,
          source_url: u,
          source_type: type,
          name: obs.name,
          address: obs.address,
          phone: obs.phone,
          match_score: score,
          mismatch: mismatchJson,
        })
        if (buffer.length >= 8) {
          await flushBuffer()
        }
      } catch (e: any) {
        observations.push({ url: u, source_type: type, name: null, address: null, phone: null, match_score: 0, mismatch: { error: e?.message || 'fetch_failed', flags: { name: false, address: false, phone: false } }, last_post_at: null })
        buffer.push({
          audit_id: auditId,
          business_id: businessId,
          source_url: u,
          source_type: type,
          name: null,
          address: null,
          phone: null,
          match_score: 0,
          mismatch: { error: e?.message || 'fetch_failed', flags: { name: false, address: false, phone: false } },
        })
        if (buffer.length >= 8) {
          await flushBuffer()
        }
      }
      await new Promise(r => setTimeout(r, 150))
    }

    // Persist any remaining buffered rows
    try {
      await flushBuffer()
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || 'Insert failed' }, { status: 500 })
    }

    // Listing opportunities: any directory in AU_DIRECTORIES without strong match (>=85)
    const strongByDirKey = new Set<string>()
    for (const o of observations) {
      const h = hostOf(o.url)
      if (!h) continue
      const d = findDirectoryByHost(h)
      if (!d) continue
      if (o.match_score >= 85) strongByDirKey.add(d.key)
    }

    const opsToInsert: Array<{ audit_id: string, directory: string, suggested_url?: string|null, reason?: string|null, priority: number }> = []

    for (const d of AU_DIRECTORIES) {
      if (d.category === 'social' || d.category === 'maps') continue // opportunities focus on directory/review/leads
      if (strongByDirKey.has(d.key)) continue
      // Check if we already have an opportunity for this audit+directory
      const priority = Math.max(1, 11 - (d.weight || 3))
      opsToInsert.push({ audit_id: auditId, directory: d.key, suggested_url: null, reason: 'not found or weak match', priority })
    }

    if (opsToInsert.length) {
      // Deduplicate existing
      for (const op of opsToInsert) {
        const { data: existing } = await supabase
          .from('listing_opportunities')
          .select('id')
          .eq('audit_id', op.audit_id)
          .eq('directory', op.directory)
          .limit(1)
        if (!existing || existing.length === 0) {
          await supabase.from('listing_opportunities').insert(op)
        }
      }
    }

    // Snapshot full scrape output
    const snapshot = { observations, socialsLast, capturedAt: new Date().toISOString() }
    await supabase.from('business_snapshots').insert({ business_id: businessId, audit_id: auditId, source: 'manual', data: { scrape: snapshot } })

    // Merge socials_last into businesses.golden_profile
    if (Object.keys(socialsLast).length) {
      const { data: bizRow } = await supabase.from('businesses').select('golden_profile').eq('id', businessId).single()
      const golden = (bizRow as any)?.golden_profile || {}
      const mergedGolden = { ...golden, socials_last: { ...(golden?.socials_last || {}), ...socialsLast } }
      await supabase.from('businesses').update({ golden_profile: mergedGolden }).eq('id', businessId)
    }

    return NextResponse.json({ ok: true, data: { observations, socialsLast } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
