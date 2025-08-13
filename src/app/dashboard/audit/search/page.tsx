'use client'

import { useMemo, useState } from 'react'

type PlaceCandidate = {
  position: number
  title: string
  address?: string
  latitude?: number
  longitude?: number
  rating?: number
  ratingCount?: number
  category?: string
  phoneNumber?: string
  website?: string
  cid?: string
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

export default function AuditSearchPage() {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([])
  const [error, setError] = useState<string | null>(null)

  const canSearch = useMemo(() => name.trim().length > 0 || address.trim().length > 0 || phone.trim().length > 0, [name, address, phone])

  async function onSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!canSearch) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/audit/places/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address, phone })
      })
      const json = (await res.json()) as ApiResponse<{ candidates: PlaceCandidate[] }>
      if (!res.ok || !('ok' in json) || !json.ok) throw new Error((json as any).error || 'Search failed')
      setCandidates(json.data.candidates || [])
    } catch (err: any) {
      setError(err.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function onConfirm(c: PlaceCandidate) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/audit/places/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: c })
      })
      const json = (await res.json()) as ApiResponse<{ auditId: string; businessId: string }>
      if (!res.ok || !('ok' in json) || !json.ok) throw new Error((json as any).error || 'Confirm failed')
      const { auditId } = (json as any).data
      window.location.href = `/dashboard/audit/${auditId}`
    } catch (err: any) {
      setError(err.message || 'Confirm failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Audit — Search</h1>
      <p className="mt-2 text-sm text-gray-600">Search Google Places AU using business NAP. Confirm the Golden NAP to start the audit.</p>

      <form onSubmit={onSearch} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input className="rounded border px-3 py-2" placeholder="Business name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="rounded border px-3 py-2" placeholder="Address / City" value={address} onChange={(e) => setAddress(e.target.value)} />
        <input className="rounded border px-3 py-2" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="sm:col-span-3">
          <button disabled={!canSearch || loading} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{loading ? 'Searching…' : 'Search Places'}</button>
        </div>
      </form>

      {error && <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mt-6">
        {candidates.length === 0 && !loading && (
          <div className="text-sm text-gray-500">No results yet.</div>
        )}
        <ul className="space-y-3">
          {candidates.map((c) => (
            <li key={`${c.cid ?? c.title}-${c.position}`} className="rounded border p-3">
              <div className="text-lg font-medium">{c.title}</div>
              <div className="text-sm text-gray-600">{c.address ?? '—'}</div>
              <div className="mt-1 text-xs text-gray-500">
                {c.category ? <span>{c.category}</span> : null}{c.category && (c.rating || c.ratingCount) ? ' · ' : ''}
                {c.rating ? <span>⭐ {c.rating} ({c.ratingCount ?? 0})</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                {c.phoneNumber && <span>{c.phoneNumber}</span>}
                {c.website && <a className="text-blue-600 hover:underline" href={c.website} target="_blank" rel="noreferrer">Website</a>}
                <button onClick={() => onConfirm(c)} className="text-blue-600 hover:underline">Confirm Golden NAP</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
