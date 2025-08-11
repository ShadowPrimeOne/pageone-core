import { createClient } from '@/lib/supabase/server'

type Props = { params: { business: string } }

export default async function BusinessStatusPage({ params }: Props) {
  const supabase = createClient()

  let name: string | null = null
  let health: number | null = null
  let updatedAt: string | null = null
  let errorMsg: string | null = null

  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('name, slug, health_score, updated_at')
      .eq('slug', params.business)
      .maybeSingle()

    if (error) throw error
    if (data) {
      name = data.name ?? params.business
      health = (data as any).health_score ?? null
      updatedAt = (data as any).updated_at ?? null
    }
  } catch (e: any) {
    // Table may not exist yet or other RLS error; fall back to stub
    errorMsg = e?.message ?? 'Unavailable'
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">{name ?? `Status: ${params.business}`}</h1>
      <p className="mt-2 text-sm text-gray-600">Public status stub. Secure link/QR coming later.</p>

      <div className="mt-6 rounded border p-4">
        <div className="flex items-baseline gap-3">
          <span className="text-sm text-gray-500">Health Score</span>
          <span className="text-3xl font-bold">{health ?? 72}</span>
        </div>
        <p className="mt-2 text-xs text-gray-500">Last updated: {updatedAt ? new Date(updatedAt).toLocaleString() : '—'}</p>
        {errorMsg && (
          <p className="mt-2 text-xs text-amber-600">Note: {errorMsg}. Showing placeholder values.</p>
        )}
      </div>
    </main>
  )
}
