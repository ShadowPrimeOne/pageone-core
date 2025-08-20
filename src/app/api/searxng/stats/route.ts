import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const searx = process.env.SEARXNG_BASE_URL || 'https://searxng.pageone.live'
  const base = searx.replace(/\/+$/, '')
  const url = `${base}/stats?format=json`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), 6000)

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `SearXNG stats HTTP ${res.status}` }, { status: 502 })
    }
    const stats = await res.json().catch(() => null)
    return NextResponse.json({ ok: true, data: { base, stats } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'fetch_failed' }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}
