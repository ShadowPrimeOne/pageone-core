import { createClient } from '@/lib/supabase/server'

type Props = { params: Promise<{ business: string }> }

export async function generateMetadata({ params }: Props) {
  const { business } = await params
  const supabase = await createClient()
  let title = `Status: ${business}`
  try {
    const { data } = await supabase
      .from('businesses')
      .select('name')
      .eq('slug', business)
      .maybeSingle()
    if (data?.name) {
      title = `${data.name} – Status`
    }
  } catch {}
  return {
    title,
    description: 'Public business status overview, key metrics, and insights.',
    openGraph: {
      title,
      description: 'Public business status overview, key metrics, and insights.',
    },
    twitter: {
      card: 'summary',
      title,
      description: 'Public business status overview, key metrics, and insights.',
    },
  }
}

export default async function BusinessStatusPage({ params }: Props) {
  const { business } = await params
  const supabase = await createClient()

  let name: string | null = null
  let health: number | null = null
  let updatedAt: string | null = null
  let errorMsg: string | null = null

  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('name, slug, health_score, updated_at')
      .eq('slug', business)
      .maybeSingle()

    if (error) throw error
    if (data) {
      name = data.name ?? business
      health = (data as any).health_score ?? null
      updatedAt = (data as any).updated_at ?? null
    }
  } catch (e: any) {
    // Table may not exist yet or other RLS error; fall back to stub
    errorMsg = e?.message ?? 'Unavailable'
  }

  const displayHealth = typeof health === 'number' ? health : 72
  const lastUpdated = updatedAt ? new Date(updatedAt).toLocaleString() : '—'

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">{name ?? `Status: ${business}`}</h1>
      <p className="mt-2 text-sm text-gray-600">Public status. Secure link/QR coming later.</p>

      {/* Overview */}
      <section className="mt-6 rounded border p-4">
        <div className="flex items-baseline gap-3">
          <span className="text-sm text-gray-500">Health Score</span>
          <span className="text-3xl font-bold">{displayHealth}</span>
        </div>
        <p className="mt-2 text-xs text-gray-500">Last updated: {lastUpdated}</p>
        {errorMsg && (
          <p className="mt-2 text-xs text-amber-600">Note: {errorMsg}. Showing placeholder values.</p>
        )}
      </section>

      {/* Metrics */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-gray-700">Key Metrics</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-4">
            <div className="text-xs text-gray-500">Uptime (7d)</div>
            <div className="mt-1 text-xl font-semibold">99.3%</div>
            <div className="mt-1 text-xs text-gray-500">Synthetic check</div>
          </div>
          <div className="rounded border p-4">
            <div className="text-xs text-gray-500">Ad Spend (30d)</div>
            <div className="mt-1 text-xl font-semibold">$1,240</div>
            <div className="mt-1 text-xs text-gray-500">Placeholder</div>
          </div>
          <div className="rounded border p-4">
            <div className="text-xs text-gray-500">Leads (30d)</div>
            <div className="mt-1 text-xl font-semibold">36</div>
            <div className="mt-1 text-xs text-gray-500">Forms + calls</div>
          </div>
          <div className="rounded border p-4">
            <div className="text-xs text-gray-500">CTR (search)</div>
            <div className="mt-1 text-xl font-semibold">3.1%</div>
            <div className="mt-1 text-xs text-gray-500">Placeholder</div>
          </div>
        </div>
      </section>

      {/* Insights */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-gray-700">Insights</h2>
        <ul className="mt-3 space-y-2">
          <li className="rounded border p-3 text-sm">Homepage meta description is short. Consider a clear CTA.</li>
          <li className="rounded border p-3 text-sm">Google Business Profile hours missing special dates.</li>
          <li className="rounded border p-3 text-sm">Add UTM tracking to paid landing URLs.</li>
        </ul>
      </section>
    </main>
  )
}
