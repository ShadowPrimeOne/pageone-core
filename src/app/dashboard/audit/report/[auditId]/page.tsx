'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useParams } from 'next/navigation'

type UrlItem = { url: string; host: string; source_type: 'social'|'directory'|'places'|'web'; title?: string; content?: string }

type PlatformRow = {
  url: string
  source_type: string
  score: number | null
  status: 'green' | 'orange' | 'red'
  mismatch?: any
}

type PlatformSummary = {
  key: string
  name: string
  category: string
  weight: number
  status: 'green' | 'orange' | 'red'
  contribution: number
  urls: PlatformRow[]
}

type ReportData = {
  golden: { name?: string|null; address?: string|null; phone?: string|null }
  scoring: { thresholds: any; contribution: any; totalWeight: number; obtained: number; overallScore: number }
  platforms: PlatformSummary[]
  generatedAt: string
}

export default function AuditReportPage() {
  const search = useSearchParams()
  const routeParams = useParams<{ auditId: string }>()
  const auditId = (routeParams?.auditId as string) || ''
  const businessId = search.get('businessId') || ''

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string|undefined>()
  const [urls, setUrls] = useState<UrlItem[]|null>(null)
  const [report, setReport] = useState<ReportData|undefined>()

  const sortedPlatforms = useMemo(() => {
    if (!report?.platforms) return []
    return [...report.platforms].sort((a, b) => b.weight - a.weight)
  }, [report])

  const runDiscovery = useCallback(async () => {
    setError(undefined)
    const res = await fetch('/api/audit/discovery/urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, auditId })
    })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error || 'Discovery failed')
    setUrls(j.data.urls as UrlItem[])
  }, [businessId, auditId])

  const runScrape = useCallback(async () => {
    setError(undefined)
    const res = await fetch('/api/audit/discovery/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, auditId, useDiscovery: true })
    })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error || 'Scrape failed')
  }, [businessId, auditId])

  const runReport = useCallback(async () => {
    setError(undefined)
    const res = await fetch('/api/audit/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, auditId, includeMaps: true })
    })
    const j = await res.json()
    if (!res.ok || !j.ok) throw new Error(j.error || 'Report failed')
    setReport(j.data as ReportData)
  }, [businessId, auditId])

  const runAll = useCallback(async () => {
    if (!businessId) { setError('Missing businessId in query'); return }
    setLoading(true)
    try {
      await runDiscovery()
      await runScrape()
      await runReport()
    } catch (e: any) {
      setError(e?.message || 'Run failed')
    } finally {
      setLoading(false)
    }
  }, [businessId, runDiscovery, runScrape, runReport])

  useEffect(() => {
    // no auto-run; require button click
  }, [])

  const badgeClass = (s: 'green'|'orange'|'red') => (
    s === 'green' ? 'inline-block rounded px-2 py-1 text-xs font-semibold bg-green-100 text-green-800' :
    s === 'orange' ? 'inline-block rounded px-2 py-1 text-xs font-semibold bg-amber-100 text-amber-800' :
    'inline-block rounded px-2 py-1 text-xs font-semibold bg-red-100 text-red-800'
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Audit Report</h1>
        <div className="space-x-2">
          <button onClick={runDiscovery} className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50" disabled={loading || !businessId}>Discover URLs</button>
          <button onClick={runScrape} className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={loading || !businessId}>Scrape</button>
          <button onClick={runReport} className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={loading || !businessId}>Build Report</button>
          <button onClick={runAll} className="px-3 py-2 rounded bg-black text-white disabled:opacity-50" disabled={loading || !businessId}>{loading ? 'Running…' : 'Run Full Analysis'}</button>
        </div>
      </div>

      {!businessId && (
        <div className="text-sm text-red-700">Add businessId to the URL as a query param: ?businessId=&lt;uuid&gt;</div>
      )}

      {error && <div className="text-sm text-red-700">{error}</div>}

      {report && (
        <div className="space-y-4">
          <div className="border rounded p-3">
            <div className="font-medium mb-1">Golden Record</div>
            <div className="text-sm text-gray-700">Name: {report.golden.name || '—'}</div>
            <div className="text-sm text-gray-700">Address: {report.golden.address || '—'}</div>
            <div className="text-sm text-gray-700">Phone: {report.golden.phone || '—'}</div>
          </div>

          <div className="border rounded p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">Overall Score</div>
              <div className="text-2xl font-bold">{report.scoring.overallScore}</div>
            </div>
            <div className="text-xs text-gray-600">Weights sum: {report.scoring.totalWeight} • Obtained: {report.scoring.obtained}</div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Platform</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Weight</th>
                  <th className="py-2 pr-4">Best URL</th>
                  <th className="py-2 pr-4">Best Score</th>
                  <th className="py-2 pr-4">Mismatch</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlatforms.map((p) => {
                  const best = [...p.urls].sort((a, b) => (b.score || 0) - (a.score || 0))[0]
                  const mismatchParts: string[] = []
                  if (best?.mismatch?.phone) mismatchParts.push('Phone')
                  if (best?.mismatch?.address) mismatchParts.push('Address')
                  if (best?.mismatch?.name) mismatchParts.push('Name')
                  return (
                    <tr key={p.key} className="border-b align-top">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-gray-500">{p.category}</div>
                      </td>
                      <td className="py-2 pr-4"><span className={badgeClass(p.status)}>{p.status}</span></td>
                      <td className="py-2 pr-4">{p.weight}</td>
                      <td className="py-2 pr-4">
                        {best?.url ? <a className="text-blue-700 underline" href={best.url} target="_blank" rel="noreferrer">Open</a> : '—'}
                      </td>
                      <td className="py-2 pr-4">{typeof best?.score === 'number' ? best.score : '—'}</td>
                      <td className="py-2 pr-4">{mismatchParts.length ? mismatchParts.join(', ') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {urls && !report && (
        <div className="border rounded p-3">
          <div className="font-medium mb-2">Discovered URLs ({urls.length})</div>
          <div className="text-xs text-gray-600">Proceed to Scrape → Report to compute scores.</div>
        </div>
      )}
    </div>
  )
}
