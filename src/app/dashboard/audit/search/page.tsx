'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
  raw?: any
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

export default function AuditSearchPage() {
  const searchParams = useSearchParams()
  const leadIdParam = useMemo(() => (searchParams ? (searchParams.get('leadId') || null) : null), [searchParams])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([])
  const [provider, setProvider] = useState<string | null>(null)
  const [allResults, setAllResults] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoSearched, setAutoSearched] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  // Load current user id for owner/ambassador auto-assignment on new lead creation
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null)
    }).catch(() => setUserId(null))
  }, [])

  const canSearch = useMemo(() => name.trim().length > 0 || address.trim().length > 0 || phone.trim().length > 0, [name, address, phone])

  async function executeSearch(input?: { name?: string; address?: string; phone?: string }) {
    setLoading(true)
    setError(null)
    try {
      const payload = {
        name: input?.name ?? name,
        address: input?.address ?? address,
        phone: input?.phone ?? phone,
      }
      if (!((payload.name ?? '').trim() || (payload.address ?? '').trim() || (payload.phone ?? '').trim())) {
        setLoading(false)
        return
      }
      const res = await fetch('/api/audit/places/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const json = (await res.json()) as ApiResponse<{ candidates: PlaceCandidate[]; provider?: string; allResults?: any[] }>
      if (!res.ok || !('ok' in json) || !json.ok) throw new Error((json as any).error || 'Search failed')
      setCandidates(json.data.candidates || [])
      setProvider(json.data.provider || null)
      setAllResults(json.data.allResults || null)
    } catch (err: any) {
      setError(err.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!canSearch) return
    await executeSearch()
  }

  useEffect(() => {
    if (!searchParams) return
    const n = searchParams.get('name') || ''
    const a = searchParams.get('address') || ''
    const p = searchParams.get('phone') || ''
    const has = Boolean(n || a || p)
    if (has) {
      setName(n)
      setAddress(a)
      setPhone(p)
      if (!autoSearched) {
        setAutoSearched(true)
        executeSearch({ name: n, address: a, phone: p })
      }
    }
  }, [searchParams, autoSearched])

  async function onConfirm(c: PlaceCandidate) {
    setLoading(true)
    setError(null)
    try {
      // Only use cautious phone fallback; do NOT override address from the form to avoid saving suburb-only strings
      const auPhoneLike = (v: string) => /(\+61\s?\d[\d\s-]{7,12}|0\d[\d\s-]{7,10})/.test(v)
      const candidateWithFallbacks: PlaceCandidate = {
        ...c,
        address: c.address ?? undefined,
        phoneNumber: c.phoneNumber ?? (auPhoneLike(phone) ? phone : undefined),
        title: c.title || name || 'Selected',
      }
      const res = await fetch('/api/audit/places/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate: candidateWithFallbacks,
          leadId: leadIdParam,
          provider: provider || undefined,
          raw: c.raw || undefined,
          allResults: allResults || undefined,
          ownerId: userId || undefined,
          ambassadorId: userId || undefined,
        })
      })
      const json = (await res.json()) as ApiResponse<{ auditId: string; businessId: string }>
      if (!res.ok || !('ok' in json) || !json.ok) throw new Error((json as any).error || 'Confirm failed')
      const { auditId, businessId } = (json as any).data
      // Jump directly to Report step (Step 2-3 flow), including businessId query param
      window.location.href = `/dashboard/audit/report/${auditId}?businessId=${encodeURIComponent(businessId)}`
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
                {c as any && (c as any).sourceUrl && (
                  <a className="text-blue-600 hover:underline" href={(c as any).sourceUrl} target="_blank" rel="noreferrer">View on Maps</a>
                )}
                {c.cid && <span className="text-xs text-gray-500">CID: {c.cid}</span>}
                <button onClick={() => onConfirm(c)} className="text-blue-600 hover:underline">Confirm Golden NAP</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
