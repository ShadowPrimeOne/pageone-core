import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function isHttpUrl(u?: string): u is string {
  if (!u) return false
  try {
    const url = new URL(u)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter(Boolean)))
}

function take<T>(arr: T[], n: number): T[] { return arr.slice(0, n) }

function extractBetween(html: string, re: RegExp): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    out.push(m[1])
  }
  return out
}

function tryParseJson<T = any>(s: string): T | null {
  try {
    return JSON.parse(s)
  } catch {
    // Attempt to remove HTML comments or stray tags
    try {
      const cleaned = s.replace(/<!--([\s\S]*?)-->/g, '').trim()
      return JSON.parse(cleaned)
    } catch {
      return null
    }
  }
}

function normalizeSocials(urls: string[]): { map: Record<string, string>, other: string[] } {
  const map: Record<string, string> = {}
  const other: string[] = []
  for (const u of urls) {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '')
      if (h.includes('facebook.com') && !map.facebook) map.facebook = u
      else if (h.includes('instagram.com') && !map.instagram) map.instagram = u
      else if ((h.includes('x.com') || h.includes('twitter.com')) && !map.x) map.x = u
      else if (h.includes('linkedin.com') && !map.linkedin) map.linkedin = u
      else if ((h.includes('youtube.com') || h.includes('youtu.be')) && !map.youtube) map.youtube = u
      else if (h.includes('tiktok.com') && !map.tiktok) map.tiktok = u
      else other.push(u)
    } catch {
      // ignore bad URLs
    }
  }
  return { map, other }
}

function extractMeta(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim().slice(0, 500) : null
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
  const description = descMatch ? descMatch[1].slice(0, 1000) : null
  function og(name: string) {
    const m = html.match(new RegExp(`<meta[^>]+property=["']og:${name}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'))
    return m ? m[1].slice(0, 1000) : null
  }
  return {
    title,
    description,
    og: {
      url: og('url'),
      title: og('title'),
      site_name: og('site_name'),
      description: og('description'),
    }
  }
}

function extractAnchors(html: string): string[] {
  // Find anchor hrefs
  const hrefs = extractBetween(html, /<a[^>]+href=["']([^"']+)["'][^>]*>/gi)
  // Also detect tel: links (will be treated under phones)
  return hrefs
}

function extractPhones(html: string): string[] {
  const phones: string[] = []
  // tel: links
  extractBetween(html, /href=["']tel:([^"']+)["']/gi).forEach(v => phones.push(v))
  // AU phone-like patterns
  const re = /(\+61\s?\d[\d\s-]{7,12}|0\d[\d\s-]{7,10})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) phones.push(m[1])
  return uniq(phones).slice(0, 20)
}

function collectJsonLd(html: string) {
  const scripts = extractBetween(html, /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  const rawSnippets = take(scripts.map(s => s.trim().slice(0, 16000)), 5) // cap snippet size and count
  const parsed: any[] = []
  for (const s of rawSnippets) {
    const obj = tryParseJson<any>(s)
    if (!obj) continue
    if (Array.isArray(obj)) parsed.push(...obj)
    else parsed.push(obj)
  }
  const sameAsUrls: string[] = []
  const localBusiness: any[] = []
  for (const item of parsed) {
    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']].filter(Boolean)
    if (types.some((t: string) => /LocalBusiness|Organization/i.test(t))) {
      localBusiness.push(item)
    }
    const sameAs = item.sameAs
    if (Array.isArray(sameAs)) sameAsUrls.push(...sameAs)
  }
  return { rawSnippets, parsed: take(parsed, 10), localBusiness: take(localBusiness, 5), sameAsUrls: uniq(sameAsUrls) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { businessId, auditId, url } = body || {}
    if (!businessId || !isHttpUrl(url)) {
      return NextResponse.json({ ok: false, error: 'Missing businessId or invalid url' }, { status: 400 })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; PageoneAuditBot/1.0; +https://pageone.local)'
      },
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    }).catch((e) => {
      clearTimeout(timer)
      throw e
    })
    clearTimeout(timer)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json({ ok: false, error: `Fetch failed: ${text || res.status}` }, { status: 502 })
    }

    const html = await res.text()

    // Extract info
    const meta = extractMeta(html)
    const anchors = extractAnchors(html)
    const phones = extractPhones(html)
    const { rawSnippets, parsed, localBusiness, sameAsUrls } = collectJsonLd(html)

    const anchorUrls = anchors
      .filter(h => /^https?:\/\//i.test(h))
      .slice(0, 200)
    const socialFromAnchors = anchorUrls
    const socialFromJsonLd = sameAsUrls
    const socialsAll = uniq([...socialFromAnchors, ...socialFromJsonLd])

    const { map: socialsMap, other: socialsOther } = normalizeSocials(socialsAll)

    // NAP candidates from JSON-LD
    const names: string[] = []
    const addresses: Array<{ raw?: any; formatted?: string }> = []
    for (const lb of localBusiness) {
      if (lb.name && typeof lb.name === 'string') names.push(lb.name)
      const addr = lb.address
      if (addr && typeof addr === 'object') {
        const formatted = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry]
          .filter(Boolean)
          .join(', ')
        addresses.push({ raw: addr, formatted: formatted || undefined })
      }
    }

    const snapshot = {
      url,
      meta,
      socials: { ...socialsMap, other: socialsOther.length ? socialsOther : undefined },
      jsonLd: {
        snippets: rawSnippets, // stored as text snippets, not full HTML
        parsed,
        localBusiness,
        sameAs: sameAsUrls,
      },
      napHints: {
        phones,
        names: uniq(names).slice(0, 10),
        addresses: take(addresses, 10),
      },
      capturedAt: new Date().toISOString(),
    }

    const supabase = createAdminClient()

    // Merge socials into business_profiles.socials
    let mergedSocials: any = { ...socialsMap }
    if (socialsOther.length) mergedSocials.other = socialsOther

    const { data: existing, error: exErr } = await supabase
      .from('business_profiles')
      .select('id, socials')
      .eq('business_id', businessId)
      .single()
    if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 })

    if (existing?.socials && typeof existing.socials === 'object') {
      mergedSocials = { ...existing.socials, ...mergedSocials }
      // Prefer existing values if ours are missing; current spread is fine for now
    }

    const { error: updErr } = await supabase
      .from('business_profiles')
      .update({ socials: mergedSocials, website: url })
      .eq('business_id', businessId)
    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })

    // Insert snapshot
    const { data: snap, error: snapErr } = await supabase
      .from('business_snapshots')
      .insert({ business_id: businessId, audit_id: auditId ?? null, source: 'website', data: snapshot })
      .select('id')
      .single()
    if (snapErr) return NextResponse.json({ ok: false, error: snapErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, data: { snapshotId: snap.id, businessId, auditId: auditId ?? null } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
