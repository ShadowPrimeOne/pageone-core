import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AU_DIRECTORIES, DirectoryDef } from '@/lib/discovery/au_directories'

function hostOf(u: string): string | null { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }
function findDirectoryByHost(host: string): DirectoryDef | null {
  for (const d of AU_DIRECTORIES) {
    if (d.hosts.some(h => host.endsWith(h))) return d
  }
  return null
}

function statusFromScore(score?: number | null): 'green'|'orange'|'red' {
  if (typeof score !== 'number') return 'red'
  if (score >= 85) return 'green'
  if (score >= 40) return 'orange'
  return 'red'
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { businessId, auditId, includeMaps = false } = body || {}
    if (!businessId || !auditId) return NextResponse.json({ ok: false, error: 'Missing businessId or auditId' }, { status: 400 })

    const supabase = createAdminClient()

    const { data: bp, error: bpErr } = await supabase
      .from('business_profiles')
      .select('golden_name, golden_address, golden_phone')
      .eq('business_id', businessId)
      .single()
    if (bpErr || !bp) return NextResponse.json({ ok: false, error: bpErr?.message || 'Business not found' }, { status: 404 })

    const { data: obs, error: obsErr } = await supabase
      .from('nap_observations')
      .select('source_url, source_type, name, address, phone, match_score, mismatch')
      .eq('audit_id', auditId)
    if (obsErr) return NextResponse.json({ ok: false, error: obsErr.message }, { status: 500 })

    // Group observations by platform key (directory/social/maps) using host mapping
    type Row = { url: string, source_type: string, score: number|null, status: 'green'|'orange'|'red', mismatch?: any }
    type Platform = { key: string, name: string, category: DirectoryDef['category'], weight: number, rows: Row[] }

    const byKey = new Map<string, Platform>()

    // Seed platforms from config so Missing can be shown even with no hits
    for (const d of AU_DIRECTORIES) {
      if (!includeMaps && (d.category === 'maps')) continue
      if (d.category === 'social' || d.category === 'directory' || d.category === 'review' || d.category === 'leads' || (includeMaps && d.category === 'maps')) {
        byKey.set(d.key, { key: d.key, name: d.name, category: d.category, weight: d.weight || 3, rows: [] })
      }
    }

    for (const o of obs || []) {
      if (!o?.source_url) continue
      const host = hostOf(o.source_url)
      if (!host) continue
      const dir = findDirectoryByHost(host)
      if (!dir) continue
      if (!includeMaps && dir.category === 'maps') continue
      const plat = byKey.get(dir.key) || { key: dir.key, name: dir.name, category: dir.category, weight: dir.weight || 3, rows: [] }
      plat.rows.push({ url: o.source_url, source_type: o.source_type, score: o.match_score ?? null, status: statusFromScore(o.match_score), mismatch: o.mismatch })
      byKey.set(dir.key, plat)
    }

    // Compute platform status and contributions
    const platforms = Array.from(byKey.values())
    const totalWeight = platforms.reduce((s, p) => s + (p.weight || 0), 0) || 1

    let obtained = 0

    const platformSummaries = platforms.map(p => {
      // Determine best row status
      let bestStatus: 'green'|'orange'|'red' = 'red'
      let bestScore = -1
      for (const r of p.rows) {
        if (typeof r.score === 'number' && r.score > bestScore) {
          bestScore = r.score
          bestStatus = r.status
        }
      }
      // Contribution
      let contribution = 0
      if (bestStatus === 'green') contribution = p.weight
      else if (bestStatus === 'orange') contribution = p.weight * 0.5
      else contribution = 0
      obtained += contribution

      return {
        key: p.key,
        name: p.name,
        category: p.category,
        weight: p.weight,
        status: bestStatus,
        contribution,
        urls: p.rows
      }
    })

    const overallScore = Math.round((obtained / totalWeight) * 100)

    const report = {
      golden: { name: bp.golden_name, address: bp.golden_address, phone: bp.golden_phone },
      scoring: {
        thresholds: { green: '>=85', orange: '40-84', red: '<40 or no result' },
        contribution: { green: '100% weight', orange: '50% weight', red: '0%' },
        totalWeight,
        obtained,
        overallScore
      },
      platforms: platformSummaries,
      generatedAt: new Date().toISOString()
    }

    return NextResponse.json({ ok: true, data: report })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  }
}
