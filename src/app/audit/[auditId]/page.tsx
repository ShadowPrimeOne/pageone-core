import { Suspense } from 'react'
import { notFound } from 'next/navigation'

async function getStatus(auditId: string) {
  try {
    const res = await fetch(`/api/audit/status/${auditId}`, { cache: 'no-store' })
    // Attempt to parse JSON regardless of status to surface error messages
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
    return json
  } catch {
    return { ok: false, error: 'Status unavailable' }
  }
}

export default async function AuditWizardPage({ params }: { params: { auditId: string } }) {
  const auditId = params.auditId
  if (!auditId) return notFound()
  const status = await getStatus(auditId)
  const biz = (status as any)?.data?.business

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
          <div className="mt-2 text-xs text-gray-500">Directory and social observations with match scores. (Placeholder)</div>
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
