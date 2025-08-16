import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import DiscoveryAndScrapeClient from './DiscoveryAndScrapeClient'

async function getStatus(auditId: string) {
  try {
    const supabase = createAdminClient()
    const { data: audit, error: auditErr } = await supabase
      .from('audit_runs')
      .select('id, business_id, status, started_at, completed_at, summary')
      .eq('id', auditId)
      .single()
    if (auditErr || !audit) return { ok: false, error: auditErr?.message || 'Not found' }

    const { data: biz } = await supabase
      .from('business_profiles')
      .select('id, golden_name, golden_address, golden_phone, website, place_cid')
      .eq('business_id', audit.business_id)
      .single()

    const [snapshotsRes, napRes, listRes, adsRes, lhRes] = await Promise.all([
      supabase.from('business_snapshots').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
      supabase.from('nap_observations').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
      supabase.from('listing_opportunities').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
      supabase.from('ads_audit').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
      supabase.from('lighthouse_runs').select('*', { count: 'exact', head: true }).eq('audit_id', auditId),
    ])

    const counts = {
      snapshots: snapshotsRes.count ?? 0,
      nap_observations: napRes.count ?? 0,
      listing_opportunities: listRes.count ?? 0,
      ads_audit: adsRes.count ?? 0,
      lighthouse_runs: lhRes.count ?? 0,
    }

    const steps = {
      nap_confirmed: Boolean(biz?.golden_name || biz?.golden_address || biz?.golden_phone),
      snapshot: counts.snapshots > 0,
      discovery: counts.nap_observations > 0,
      ads: counts.ads_audit > 0,
      lighthouse: counts.lighthouse_runs > 0,
      complete: audit.status === 'complete',
    }

    return { ok: true, data: { audit, business: biz, counts, steps } }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Unknown error' }
  }
}

export default async function AuditWizardPage({ params }: { params: { auditId: string } }) {
  const auditId = params.auditId
  if (!auditId) return notFound()
  const status = await getStatus(auditId)
  const biz = (status as any)?.data?.business
  const businessId = (status as any)?.data?.audit?.business_id

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Audit — Wizard</h1>
      <p className="mt-2 text-sm text-gray-600">Follow steps to compile the Digital Health audit.</p>

      <div className="mt-6 grid gap-4">
        <section className="rounded border p-4">
          <h2 className="text-sm font-medium text-gray-700">1) NAP Confirmation</h2>
          <p className="mt-1 text-xs text-gray-500">Selected Golden NAP from Places. You can re-run search if needed.</p>
          {!(status as any)?.ok && (
            <div className="mt-2 text-xs text-red-600">{(status as any)?.error || 'Status fetch failed'}</div>
          )}
          {biz ? (
            <div className="mt-3 grid gap-1 text-sm">
              <div><span className="font-medium">Name:</span> {biz.golden_name ?? '—'}</div>
              <div><span className="font-medium">Address:</span> {biz.golden_address ?? '—'}</div>
              <div><span className="font-medium">Phone:</span> {biz.golden_phone ?? '—'}</div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                {biz.website && (<a className="text-blue-600 hover:underline" href={biz.website} target="_blank" rel="noreferrer">Website</a>)}
                {biz.place_cid && (<span>CID: {biz.place_cid}</span>)}
              </div>
              <div className="mt-2">
                <a
                  className="text-blue-600 hover:underline text-xs"
                  href={`/dashboard/audit/search?name=${encodeURIComponent(biz.golden_name ?? '')}&address=${encodeURIComponent(biz.golden_address ?? '')}&phone=${encodeURIComponent(biz.golden_phone ?? '')}`}
                >
                  Re-run search with current NAP
                </a>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm text-gray-500">No Golden NAP stored yet.</div>
          )}
        </section>

        <section className="rounded border p-4">
          <h2 className="text-sm font-medium text-gray-700">2) Snapshot</h2>
          <div className="mt-2 text-xs text-gray-500">Places details, website parsing, socials. (Placeholder until implemented)</div>
        </section>

        <section className="rounded border p-4">
          <h2 className="text-sm font-medium text-gray-700">3) Discovery & Consistency</h2>
          <div className="mt-2 text-xs text-gray-500">Directory and social observations with match scores.</div>
          {businessId && (
            <DiscoveryAndScrapeClient auditId={auditId} businessId={businessId} />
          )}
        </section>

        <section className="rounded border p-4">
          <h2 className="text-sm font-medium text-gray-700">4) Advertising Audit</h2>
          <div className="mt-2 text-xs text-gray-500">SERP ads presence, competitors, LP readiness. (Placeholder)</div>
        </section>

        <section className="rounded border p-4">
          <h2 className="text-sm font-medium text-gray-700">5) Lighthouse</h2>
          <div className="mt-2 text-xs text-gray-500">Performance, SEO, best-practices, accessibility. (Placeholder)</div>
        </section>

        <section className="rounded border p-4">
          <h2 className="text-sm font-medium text-gray-700">6) Report</h2>
          <div className="mt-2 text-xs text-gray-500">Digital Health meter and action plan. (Placeholder)</div>
        </section>
      </div>

      <Suspense>
        <pre className="mt-6 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">{JSON.stringify(status, null, 2)}</pre>
      </Suspense>
    </main>
  )
}
