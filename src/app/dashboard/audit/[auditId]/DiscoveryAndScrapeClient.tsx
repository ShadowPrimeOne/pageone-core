"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type UrlItem = { url: string; title?: string; content?: string; host: string; source_type: 'social'|'directory'|'places'|'web' }

type Observation = {
  source_url: string
  source_type: 'social'|'directory'|'web'|'places'
  name: string | null
  address: string | null
  phone: string | null
  match_score: number | null
  mismatch?: any
}

type Report = {
  golden: { name?: string|null, address?: string|null, phone?: string|null }
  scoring: { thresholds: any, contribution: any, totalWeight: number, obtained: number, overallScore: number }
  platforms: Array<{ key: string, name: string, category: string, weight: number, status: 'green'|'orange'|'red', contribution: number, urls: Array<{ url: string, source_type: string, score: number|null, status: 'green'|'orange'|'red' }> }>
  generatedAt: string
}

export default function DiscoveryAndScrapeClient({ auditId, businessId }: { auditId: string, businessId: string }) {
  const [discovery, setDiscovery] = useState<UrlItem[] | null>(null)
  const [observations, setObservations] = useState<Observation[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState<{ discovery?: boolean, scrape?: boolean, report?: boolean }>({})
  const [progress, setProgress] = useState<{ total: number, done: number }>({ total: 0, done: 0 })
  const [logs, setLogs] = useState<string[]>([])
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-200), `${new Date().toLocaleTimeString()} — ${msg}`])
  }, [])

  const runDiscovery = useCallback(async () => {
    setLoading(l => ({ ...l, discovery: true }))
    setReport(null)
    setObservations([])
    setProgress({ total: 0, done: 0 })
    setLogs([])
    try {
      const res = await fetch('/api/audit/discovery/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, auditId })
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Discovery failed')
      const urls: UrlItem[] = json.data?.urls || []
      setDiscovery(urls)
      setProgress({ total: urls.length, done: 0 })
      addLog(`Discovery found ${urls.length} unique URLs`)
    } catch (e: any) {
      addLog(`Discovery error: ${e?.message || e}`)
    } finally {
      setLoading(l => ({ ...l, discovery: false }))
    }
  }, [auditId, businessId, addLog])

  const fetchObservations = useCallback(async () => {
    try {
      const res = await fetch(`/api/audit/observations?auditId=${encodeURIComponent(auditId)}`, { cache: 'no-store' })
      const json = await res.json()
      if (json?.ok) {
        const rows: Observation[] = json.data || []
        setObservations(rows)
        setProgress(p => ({ total: p.total, done: rows.length }))
      }
    } catch {
      // ignore
    }
  }, [auditId])

  const pollProgress = useCallback(() => {
    if (pollerRef.current) return
    pollerRef.current = setInterval(() => {
      fetch(`/api/audit/status/${encodeURIComponent(auditId)}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(s => {
          if (s?.ok) {
            const done = s.data?.counts?.nap_observations ?? 0
            setProgress(p => ({ total: p.total, done }))
          }
        })
        .catch(() => {})
      fetchObservations()
    }, 1200)
  }, [auditId, fetchObservations])

  const stopPoll = useCallback(() => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current)
      pollerRef.current = null
    }
  }, [])

  const startScrape = useCallback(async () => {
    if (!discovery || discovery.length === 0) {
      addLog('No discovery URLs yet. Run discovery first.')
      return
    }
    setLoading(l => ({ ...l, scrape: true }))
    setReport(null)
    setObservations([])
    setProgress({ total: discovery.length, done: 0 })
    addLog('Starting scrape…')
    pollProgress()
    try {
      const res = await fetch('/api/audit/discovery/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, auditId, useDiscovery: true, urls: discovery.map(u => u.url) })
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Scrape failed')
      addLog(`Scrape finished. Inserted ${json?.data?.observations?.length ?? 0} observations.`)
      await fetchObservations()
    } catch (e: any) {
      addLog(`Scrape error: ${e?.message || e}`)
    } finally {
      setLoading(l => ({ ...l, scrape: false }))
      stopPoll()
    }
  }, [auditId, businessId, discovery, pollProgress, stopPoll, addLog, fetchObservations])

  const runReport = useCallback(async () => {
    setLoading(l => ({ ...l, report: true }))
    addLog('Generating report…')
    try {
      const res = await fetch('/api/audit/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, auditId })
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Report failed')
      setReport(json.data)
      addLog(`Report ready. Overall score ${json.data?.scoring?.overallScore}`)
    } catch (e: any) {
      addLog(`Report error: ${e?.message || e}`)
    } finally {
      setLoading(l => ({ ...l, report: false }))
    }
  }, [auditId, businessId, addLog])

  const percent = useMemo(() => {
    const { total, done } = progress
    if (!total) return 0
    return Math.min(100, Math.round((done / total) * 100))
  }, [progress])

  useEffect(() => () => stopPoll(), [stopPoll])

  return (
    <div className="mt-3">
      <div className="flex gap-2 mb-2">
        <button className="px-3 py-1 rounded bg-gray-800 text-white text-xs disabled:opacity-50" onClick={runDiscovery} disabled={!!loading.discovery}>Run discovery</button>
        <button className="px-3 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50" onClick={startScrape} disabled={!!loading.scrape || !discovery?.length}>Start scrape</button>
        <button className="px-3 py-1 rounded bg-emerald-600 text-white text-xs disabled:opacity-50" onClick={runReport} disabled={!!loading.report || !observations.length}>Generate report</button>
      </div>

      {progress.total > 0 && (
        <div className="mb-3">
          <div className="h-2 w-full rounded bg-gray-200 overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-1 text-xs text-gray-600">{progress.done} / {progress.total} processed</div>
        </div>
      )}

      {discovery && (
        <div className="mt-3">
          <div className="text-xs text-gray-600 mb-1">Discovered URLs</div>
          <div className="overflow-auto rounded border">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left">Type</th>
                  <th className="px-2 py-1 text-left">URL</th>
                </tr>
              </thead>
              <tbody>
                {discovery.map((u, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1"><span className="rounded bg-gray-100 px-2 py-0.5">{u.source_type}</span></td>
                    <td className="px-2 py-1"><a className="text-blue-600 hover:underline" href={u.url} target="_blank" rel="noreferrer">{u.url}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {observations.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-gray-600 mb-1">Scrape observations</div>
          <div className="overflow-auto rounded border">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left">Type</th>
                  <th className="px-2 py-1 text-left">Score</th>
                  <th className="px-2 py-1 text-left">URL</th>
                  <th className="px-2 py-1 text-left">Name</th>
                  <th className="px-2 py-1 text-left">Phone</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1">{o.source_type}</td>
                    <td className="px-2 py-1">{o.match_score ?? '—'}</td>
                    <td className="px-2 py-1 max-w-[420px] truncate"><a className="text-blue-600 hover:underline" href={o.source_url} target="_blank" rel="noreferrer">{o.source_url}</a></td>
                    <td className="px-2 py-1">{o.name ?? '—'}</td>
                    <td className="px-2 py-1">{o.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report && (
        <div className="mt-4">
          <div className="text-xs text-gray-600 mb-1">Report</div>
          <div className="rounded border p-2">
            <div className="text-sm mb-2">Overall score: <span className="font-semibold">{report.scoring.overallScore}</span></div>
            <div className="overflow-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-1 text-left">Platform</th>
                    <th className="px-2 py-1 text-left">Category</th>
                    <th className="px-2 py-1 text-left">Status</th>
                    <th className="px-2 py-1 text-left">Weight</th>
                    <th className="px-2 py-1 text-left">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {report.platforms.map(p => (
                    <tr key={p.key} className="border-t">
                      <td className="px-2 py-1">{p.name}</td>
                      <td className="px-2 py-1">{p.category}</td>
                      <td className="px-2 py-1">{p.status}</td>
                      <td className="px-2 py-1">{p.weight}</td>
                      <td className="px-2 py-1">{p.contribution}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-gray-600 mb-1">Logs</div>
          <div className="rounded border bg-gray-50 p-2 text-[11px] text-gray-700 whitespace-pre-wrap max-h-40 overflow-auto">
            {logs.map((l, i) => (<div key={i}>{l}</div>))}
          </div>
        </div>
      )}
    </div>
  )
}
