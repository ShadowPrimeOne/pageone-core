"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type UrlItem = { url: string; title?: string; content?: string; host: string; source_type: 'social'|'directory'|'places'|'web'; score?: number; rank?: number; exact?: boolean; bigram?: boolean; phone?: boolean; geo?: boolean; wrongLocation?: boolean; occupationOnly?: boolean; jobBoard?: boolean }

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
  const [keep, setKeep] = useState<Record<string, boolean>>({})
  const [threshold, setThreshold] = useState<number>(12)
  const [hideLow, setHideLow] = useState<boolean>(true)
  const [filterExact, setFilterExact] = useState<boolean>(false)
  const [filterPhone, setFilterPhone] = useState<boolean>(false)
  const [filterGeo, setFilterGeo] = useState<boolean>(false)
  const [website, setWebsite] = useState<string | null>(null)
  const [socials, setSocials] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [obsInclude, setObsInclude] = useState<Record<string, boolean>>({})

  const normUrl = useCallback((u: string) => {
    try { const x = new URL(u); x.search=''; x.hash=''; return `${x.protocol}//${x.host}${x.pathname}` } catch { return u }
  }, [])

  const detectSocialKey = useCallback((u: string): { key: string | null } => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '')
      if (h.includes('facebook.com')) return { key: 'facebook' }
      if (h.includes('instagram.com')) return { key: 'instagram' }
      if (h.includes('linkedin.com')) return { key: 'linkedin' }
      if (h.includes('x.com') || h.includes('twitter.com')) return { key: 'x' }
      if (h.includes('youtube.com') || h.includes('youtu.be')) return { key: 'youtube' }
      if (h.includes('tiktok.com')) return { key: 'tiktok' }
      return { key: null }
    } catch { return { key: null } }
  }, [])

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-200), `${new Date().toLocaleTimeString()} — ${msg}`])
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/audit/status/${encodeURIComponent(auditId)}`, { cache: 'no-store' })
      const json = await res.json()
      if (json?.ok) {
        const w = json.data?.business?.website || null
        setWebsite(typeof w === 'string' ? w : null)
        const s = json.data?.business?.socials || {}
        setSocials(s && typeof s === 'object' ? s : {})
      }
    } catch {
      // ignore
    }
  }, [auditId])

  useEffect(() => { refreshStatus() }, [refreshStatus])

  const runDiscovery = useCallback(async () => {
    setLoading(l => ({ ...l, discovery: true }))
    setReport(null)
    setObservations([])
    setProgress({ total: 0, done: 0 })
    setLogs([])
    setDiscovery(null)
    setKeep({})
    setExpanded({})
    const items: UrlItem[] = []
    const seen = new Set<string>()
    try {
      const res = await fetch('/api/audit/discovery/urls?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ businessId, auditId })
      })
      // Fallback to JSON mode if streaming isn't available
      const ct = res.headers.get('content-type') || ''
      if (!res.body || !ct.includes('text/event-stream')) {
        const json = await res.json()
        if (!json?.ok) throw new Error(json?.error || 'Discovery failed')
        const urls: UrlItem[] = (json.data?.urls || []).slice().sort((a: UrlItem, b: UrlItem) => (b.score ?? 0) - (a.score ?? 0))
        setDiscovery(urls)
        setKeep(prev => {
          const next = { ...prev }
          for (const u of urls) {
            const key = normUrl(u.url)
            if (next[key] === undefined) next[key] = ((u.score ?? 0) >= threshold)
          }
          return next
        })
        setProgress({ total: urls.length, done: urls.length })
        addLog(`Discovery found ${urls.length} unique URLs`)
        return
      }

      addLog('Discovery started (streaming)…')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const pushItem = (it: UrlItem) => {
        const key = normUrl(it.url)
        if (seen.has(key)) return
        seen.add(key)
        items.push({ ...it, url: key })
        setKeep(prev => ({ ...prev, [key]: prev[key] ?? ((it.score ?? 0) >= threshold) }))
        setDiscovery([...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)))
        setProgress({ total: items.length, done: items.length })
        addLog(`+ ${it.source_type}: ${key}`)
      }

      const handleEvent = (event: string, dataRaw: string) => {
        let data: any = null
        try { data = dataRaw ? JSON.parse(dataRaw) : null } catch {}
        if (event === 'meta') {
          addLog(`Provider: ${data?.provider} @ ${data?.searx}`)
          if (Array.isArray(data?.queries)) addLog(`Queries: ${data.queries.length}`)
        } else if (event === 'query:start') {
          addLog(`Q: ${data?.q}`)
        } else if (event === 'query:error') {
          addLog(`Q ERR: ${data?.q ?? ''} ${data?.status ?? ''} ${data?.error ?? ''}`)
        } else if (event === 'item') {
          if (data?.url && data?.source_type) pushItem(data as UrlItem)
        } else if (event === 'query:done') {
          addLog(`Q done (${data?.count ?? 0} urls, ${data?.elapsed ?? '?'}ms)`)        
        } else if (event === 'snapshot:saved') {
          addLog(`Snapshot saved (${data?.count ?? 0} urls) for audit ${data?.auditId ?? ''}`)
        } else if (event === 'done') {
          addLog(`Discovery complete. Total ${data?.total ?? items.length}`)
        } else if (event === 'fatal') {
          addLog(`Fatal: ${data?.error ?? 'unknown'}`)
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const lines = raw.split('\n')
          let event = 'message'
          const dataLines: string[] = []
          for (const ln of lines) {
            if (ln.startsWith('event: ')) event = ln.slice(7).trim()
            else if (ln.startsWith('data: ')) dataLines.push(ln.slice(6))
          }
          handleEvent(event, dataLines.join('\n'))
        }
      }
      addLog(`Discovery stream ended. Found ${items.length} URLs.`)
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
        // Initialize inclusion state for new observations
        setObsInclude(prev => {
          const next = { ...prev }
          for (const r of rows) {
            if (next[r.source_url] === undefined) next[r.source_url] = true
          }
          return next
        })
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
    const selected = discovery.filter(u => keep[normUrl(u.url)]).map(u => u.url)
    if (selected.length === 0) {
      addLog('No URLs selected. Adjust threshold or select rows to proceed.')
      return
    }
    setLoading(l => ({ ...l, scrape: true }))
    setReport(null)
    setObservations([])
    setProgress({ total: selected.length, done: 0 })
    addLog(`Starting scrape with ${selected.length} selected of ${discovery.length} discovered…`)
    pollProgress()
    try {
      const res = await fetch('/api/audit/discovery/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, auditId, useDiscovery: true, urls: selected })
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

  const setAsWebsite = useCallback(async (url: string) => {
    try {
      const u = new URL(url)
      const origin = `${u.protocol}//${u.host}`
      addLog(`Setting website to ${origin} …`)
      const res = await fetch('/api/audit/website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditId, businessId, website: origin })
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to set website')
      setWebsite(json.data?.website ?? origin)
      addLog(`Website set to ${origin}. You can re-run discovery to auto-exclude this domain.`)
    } catch (e: any) {
      addLog(`Set website error: ${e?.message || e}`)
    }
  }, [auditId, businessId, addLog])

  const addOrReplaceSocial = useCallback(async (url: string, forceReplace?: boolean) => {
    try {
      const { key } = detectSocialKey(url)
      if (!key) { addLog('Unsupported social URL'); return }
      const existing = socials[key]
      const willReplace = !!existing && !!forceReplace
      addLog(`${existing ? (willReplace ? 'Replacing' : 'Already set, not replacing') : 'Adding'} ${key} …`)
      if (existing && !willReplace) return
      const res = await fetch('/api/audit/socials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditId, businessId, url, key, replace: willReplace })
      })
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to save social')
      setSocials(json.data?.socials || {})
      addLog(`${existing ? 'Replaced' : 'Added'} ${key}`)
    } catch (e: any) {
      addLog(`Social save error: ${e?.message || e}`)
    }
  }, [auditId, businessId, socials, detectSocialKey, addLog])

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
        <button className="ui-surface ui-border ui-hover rounded px-3 py-1 text-xs disabled:opacity-50" onClick={runDiscovery} disabled={!!loading.discovery}>Run discovery</button>
        <button className="ui-surface ui-border ui-hover rounded px-3 py-1 text-xs disabled:opacity-50" onClick={startScrape} disabled={!!loading.scrape || !discovery?.length}>Start scrape</button>
        <button className="ui-surface ui-border ui-hover rounded px-3 py-1 text-xs disabled:opacity-50" onClick={runReport} disabled={!!loading.report || !observations.length}>Generate report</button>
      </div>

      <div className="text-xs ui-muted mb-2">
        <span className="mr-2">Website:</span>
        {website ? (
          <span className="px-2 py-0.5 ui-surface ui-border rounded">
            {(() => { try { const h = new URL(website!).hostname.replace(/^www\./,''); return h } catch { return website } })()}
          </span>
        ) : (
          <span className="italic ui-muted">— not set —</span>
        )}
      </div>

      <div className="text-xs ui-muted mb-2">
        <span className="mr-2">Socials:</span>
        {Object.keys(socials || {}).length ? (
          <span className="flex gap-2 flex-wrap">
            {Object.entries(socials).map(([k, v]) => (
              v ? (
                <a key={k} className="px-2 py-0.5 ui-surface ui-border rounded text-blue-700 hover:underline" href={v} target="_blank" rel="noreferrer">{k}</a>
              ) : null
            ))}
          </span>
        ) : (
          <span className="italic ui-muted">— none —</span>
        )}
      </div>

      {progress.total > 0 && (
        <div className="mb-3">
          <div className="h-2 w-full rounded ui-border overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-1 text-xs ui-muted">{progress.done} / {progress.total} processed</div>
        </div>
      )}

      {discovery && (
        <div className="mt-3">
          <div className="text-xs ui-muted mb-1 flex items-center gap-3 flex-wrap">
            <span>Discovered URLs</span>
            <label className="flex items-center gap-1">
              <span>Threshold</span>
              <input className="ui-input w-16 text-xs" type="number" value={threshold} onChange={e => setThreshold(parseInt(e.target.value || '0', 10))} />
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={hideLow} onChange={e => setHideLow(e.target.checked)} />
              <span>Hide below threshold</span>
            </label>
            <button className="ui-surface ui-border ui-hover rounded px-2 py-0.5 text-xs" onClick={() => setKeep(Object.fromEntries((discovery||[]).map(u => [normUrl(u.url), (u.score ?? 0) >= threshold])))}>Select ≥ threshold</button>
            <button className="ui-surface ui-border ui-hover rounded px-2 py-0.5 text-xs" onClick={() => setKeep(Object.fromEntries((discovery||[]).map(u => [normUrl(u.url), false])))}>Select none</button>
            <span className="mx-1">•</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={filterExact} onChange={e => setFilterExact(e.target.checked)} /> <span>Exact name</span></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={filterPhone} onChange={e => setFilterPhone(e.target.checked)} /> <span>Has phone</span></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={filterGeo} onChange={e => setFilterGeo(e.target.checked)} /> <span>Has geo</span></label>
          </div>
          <div className="overflow-auto rounded ui-border">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left">Keep</th>
                  <th className="px-2 py-1 text-left">Toggle</th>
                  <th className="px-2 py-1 text-left">Score</th>
                  <th className="px-2 py-1 text-left">Type</th>
                  <th className="px-2 py-1 text-left">Result</th>
                  <th className="px-2 py-1 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(discovery
                  .filter(u => hideLow ? ((u.score ?? 0) >= threshold) : true)
                  .filter(u => filterExact ? !!u.exact : true)
                  .filter(u => filterPhone ? !!u.phone : true)
                  .filter(u => filterGeo ? !!u.geo : true)
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                ).map((u, i) => {
                  const key = normUrl(u.url)
                  const checked = !!keep[key]
                  const isOpen = !!expanded[key]
                  return (
                    <React.Fragment key={i}>
                      <tr className="border-t align-top">
                        <td className="px-2 py-1">
                          <input type="checkbox" checked={checked} onChange={e => setKeep(prev => ({ ...prev, [key]: e.target.checked }))} />
                        </td>
                        <td className="px-2 py-1 w-12">
                          <button
                            className="ui-surface ui-border ui-hover rounded px-2 py-0.5 text-xs"
                            onClick={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
                            title={isOpen ? 'Hide details' : 'Show details'}
                          >{isOpen ? '▾' : '▸'}</button>
                        </td>
                        <td className="px-2 py-1 w-16">{u.score ?? '—'}</td>
                        <td className="px-2 py-1"><span className="rounded ui-surface ui-border px-2 py-0.5">{u.source_type}</span></td>
                        <td className="px-2 py-1 max-w-[540px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <a className="text-blue-600 hover:underline truncate" href={u.url} target="_blank" rel="noreferrer" title={u.title || u.url}>{u.title || u.url}</a>
                            <span className="ui-muted truncate">{(() => { try { return new URL(u.url).hostname.replace(/^www\./,'') } catch { return u.host || '' } })()}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {u.exact ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Exact</span> : null}
                            {u.bigram && !u.exact ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Name bigram</span> : null}
                            {u.phone ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Phone</span> : null}
                            {u.geo ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Geo</span> : null}
                            {u.jobBoard ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Job board</span> : null}
                            {u.occupationOnly ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Occupation-only</span> : null}
                            {u.wrongLocation ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Wrong location</span> : null}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <button
                            className="ui-surface ui-border ui-hover rounded px-2 py-0.5 text-xs"
                            onClick={() => setAsWebsite(u.url)}
                            title={website ? 'Replace website with this URL\'s origin' : 'Set website to this URL\'s origin'}
                          >{website ? 'Replace website' : 'Set as website'}</button>
                          {u.source_type === 'social' && (() => { const { key } = detectSocialKey(u.url); return key ? (
                            <>
                              <span className="inline-block w-2" />
                              <button
                                className="ui-surface ui-border ui-hover rounded px-2 py-0.5 text-xs"
                                onClick={() => addOrReplaceSocial(u.url, !!socials[key])}
                                title={socials[key] ? `Replace ${key}` : `Add ${key}`}
                              >{socials[key] ? `Replace ${key}` : `Add ${key}`}</button>
                            </>
                          ) : null })()}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50">
                          <td className="px-2 py-2" colSpan={6}>
                            <div className="text-[11px] text-gray-700 space-y-1">
                              <div className="font-semibold truncate" title={u.title || ''}>{u.title || '—'}</div>
                              <div className="whitespace-pre-wrap break-words">{u.content || '— (no snippet provided by search)'}</div>
                              <div className="text-gray-600 flex gap-4 flex-wrap pt-1">
                                <span><span className="text-gray-500">Host:</span> {u.host}</span>
                                <span><span className="text-gray-500">Type:</span> {u.source_type}</span>
                                <span><span className="text-gray-500">Rank:</span> {u.rank ?? '—'}</span>
                                <span><span className="text-gray-500">Score:</span> {u.score ?? '—'}</span>
                                <span><span className="text-gray-500">URL:</span> <a className="text-blue-600 hover:underline" href={u.url} target="_blank" rel="noreferrer">{u.url}</a></span>
                              </div>
                              <div className="pt-1 flex flex-wrap gap-1">
                                {u.exact ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Exact name</span> : null}
                                {u.bigram ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Name bigram</span> : null}
                                {u.phone ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Phone present</span> : null}
                                {u.geo ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Geo signal</span> : null}
                                {u.jobBoard ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Job board</span> : null}
                                {u.occupationOnly ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Occupation-only</span> : null}
                                {u.wrongLocation ? <span className="ui-surface ui-border rounded px-1.5 py-0.5 text-[10px]">Wrong location</span> : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {observations.length > 0 && (
        <div className="mt-4">
          <div className="text-xs ui-muted mb-1">Scrape observations</div>
          <div className="overflow-auto rounded ui-border">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left">Include</th>
                  <th className="px-2 py-1 text-left">Type</th>
                  <th className="px-2 py-1 text-left">Result</th>
                  <th className="px-2 py-1 text-left">NAP</th>
                  <th className="px-2 py-1 text-left">Score</th>
                  <th className="px-2 py-1 text-left">URL</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o, i) => {
                  const flags = (o as any)?.mismatch?.flags || {}
                  const present = { name: !!o.name, address: !!o.address, phone: !!o.phone }
                  const allMissing = !present.name && !present.address && !present.phone
                  let label: 'EXACT'|'PARTIAL'|'MISMATCH'|'MISSING' = 'PARTIAL'
                  if (allMissing) label = 'MISSING'
                  else if (flags.name && flags.address && flags.phone) label = 'EXACT'
                  else if ((present.name && !flags.name) || (present.address && !flags.address) || (present.phone && !flags.phone)) label = 'MISMATCH'
                  else label = 'PARTIAL'
                  const badgeCls = label === 'EXACT' ? 'bg-green-100 text-green-700' : label === 'MISMATCH' ? 'bg-red-100 text-red-700' : label === 'MISSING' ? 'bg-gray-100 text-gray-700' : 'bg-yellow-100 text-yellow-700'
                  const includeChecked = !!obsInclude[o.source_url]
                  return (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1"><input type="checkbox" checked={includeChecked} onChange={e => setObsInclude(prev => ({ ...prev, [o.source_url]: e.target.checked }))} /></td>
                      <td className="px-2 py-1">{o.source_type}</td>
                      <td className="px-2 py-1"><span className={`rounded px-2 py-0.5 ${badgeCls}`}>{label}</span></td>
                      <td className="px-2 py-1">
                        <div className="flex gap-1 items-center">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${present.name ? (flags.name ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') : 'bg-gray-100 text-gray-600'}`}>N</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${present.address ? (flags.address ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') : 'bg-gray-100 text-gray-600'}`}>A</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${present.phone ? (flags.phone ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') : 'bg-gray-100 text-gray-600'}`}>P</span>
                        </div>
                      </td>
                      <td className="px-2 py-1">{o.match_score ?? '—'}</td>
                      <td className="px-2 py-1 max-w-[520px] truncate"><a className="text-blue-600 hover:underline" href={o.source_url} target="_blank" rel="noreferrer">{o.source_url}</a></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report && (
        <div className="mt-4">
          <div className="text-xs ui-muted mb-1">Report</div>
          <div className="rounded ui-border p-2">
            <div className="text-sm mb-2">Overall score: <span className="font-semibold">{report.scoring.overallScore}</span></div>
            <div className="overflow-auto rounded ui-border">
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
          <div className="text-xs ui-muted mb-1">Logs</div>
          <div className="rounded ui-border bg-gray-50 p-2 text-[11px] text-gray-700 whitespace-pre-wrap max-h-40 overflow-auto">
            {logs.map((l, i) => (<div key={i}>{l}</div>))}
          </div>
        </div>
      )}
    </div>
  )
}
