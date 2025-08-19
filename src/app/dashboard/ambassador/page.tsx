import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createPayment, seedDemoLeads, assignLeadOwner, nukeLeadsAndClients } from './actions'
import AssignOwnerSelect from '@/components/AssignOwnerSelect'
import PipelineSearchModal from '@/components/audit/PipelineSearchModal'

export const dynamic = 'force-dynamic'

export default async function AmbassadorDashboardPage() {
  const supabase = await createClient()

  // Who is this?
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Pipeline</h1>
        <p className="mt-2 text-sm text-gray-600">Please sign in.</p>
      </main>
    )
  }

  // Role check
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  const role = profile?.role as string | null
  const isAmbassador = role === 'ambassador' || role === 'dev'
  if (!isAmbassador) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Pipeline</h1>
        <p className="mt-2 text-sm text-gray-600">Access denied.</p>
      </main>
    )
  }

  // Leads: hide converted for all; ambassadors see own, dev sees all remaining
  const baseLeadsQuery = supabase
    .from('leads')
    .select('id, slug, status, created_at, updated_at, golden_record, source, owner_id, ambassador_id, agreement_id, payment_id')
    .neq('status', 'converted')
    .order('updated_at', { ascending: false })
    .limit(25)

  const { data: leads } = role === 'dev'
    ? await baseLeadsQuery
    : await baseLeadsQuery.or(`owner_id.eq.${user.id},ambassador_id.eq.${user.id}`)

  // Determine which leads have an audit (GR OK only if audited)
  const leadIds = (leads ?? []).map((l: any) => l.id)
  let auditedLeadIds = new Set<string>()
  if (leadIds.length) {
    const { data: audits } = await supabase
      .from('lead_audits')
      .select('lead_id')
      .in('lead_id', leadIds)
    for (const a of audits ?? []) auditedLeadIds.add((a as any).lead_id as string)
  }

  // Fetch agreement statuses to detect Responded (signed)
  const agreementIds = (leads ?? [])
    .map((l: any) => l.agreement_id)
    .filter((id: any) => !!id)
  let agreementsMap = new Map<string, { status: string | null; signed_at: string | null }>()
  if (agreementIds.length) {
    const { data: ags } = await supabase
      .from('agreements')
      .select('id, status, signed_at')
      .in('id', agreementIds)
    for (const a of ags ?? []) agreementsMap.set((a as any).id, { status: (a as any).status ?? null, signed_at: (a as any).signed_at ?? null })
  }

  // Fetch payment statuses to detect Paid (paid_at or status)
  const paymentIds = (leads ?? [])
    .map((l: any) => l.payment_id)
    .filter((id: any) => !!id)
  let paymentsMap = new Map<string, { status: string | null; paid_at: string | null }>()
  if (paymentIds.length) {
    const { data: pays } = await supabase
      .from('payments')
      .select('id, status, paid_at')
      .in('id', paymentIds)
    for (const p of pays ?? []) paymentsMap.set((p as any).id, { status: (p as any).status ?? null, paid_at: (p as any).paid_at ?? null })
  }

  // Staff options for assignment (dev only)
  let assignOptions: Array<{ id: string; label: string }> = []
  if (role === 'dev') {
    const { data: staff } = await supabase
      .from('profiles')
      .select('id, full_name, role, email')
      .in('role', ['dev','ambassador'])
      .order('role', { ascending: true })
      .order('full_name', { ascending: true })
    assignOptions = (staff ?? []).map((p: any) => ({ id: p.id, label: `${p.full_name ?? p.email} (${p.role})` }))
  }

  // Clients
  let clients: Array<{ id: string, slug: string, name: string | null, health_score: number | null, updated_at: string | null }> = []
  if (role === 'dev') {
    // Devs see recent actual clients only (onboarded/subscribed)
    const { data: biz } = await supabase
      .from('businesses')
      .select('id, slug, name, health_score, updated_at')
      .in('pipeline_stage', ['onboarded','subscribed'])
      .order('updated_at', { ascending: false })
      .limit(12)
    clients = (biz ?? []) as any
  } else {
    // Ambassadors see only clients they own (owner_id) in client stages
    const { data: owned } = await supabase
      .from('businesses')
      .select('id, slug, name, health_score, updated_at')
      .eq('owner_id', user.id)
      .in('pipeline_stage', ['onboarded','subscribed'])
      .order('updated_at', { ascending: false })
    clients = (owned ?? []) as any
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Pipeline</h1>
      <p className="mt-2 text-sm text-gray-600">Overview of your leads, onboarding, and clients.</p>

      {/* Leads */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Leads</h2>
          <div className="flex items-center gap-3">
            {role === 'dev' && (
              <div className="flex items-center gap-3">
                <form action={seedDemoLeads}>
                  <button className="text-xs text-amber-700 hover:underline">Seed Demo Leads</button>
                </form>
                <form action={nukeLeadsAndClients}>
                  <button className="text-xs text-red-700 hover:underline" title="Deletes all leads and clients">Nuke All</button>
                </form>
              </div>
            )}
            <PipelineSearchModal buttonLabel="Search" variant="link" />
            <Link href="/pipeline/leads/new" className="text-xs text-blue-600 hover:underline">Add Lead</Link>
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Source</th>
                {role === 'dev' && (
                  <th className="px-3 py-2 text-left">Assigned</th>
                )}
                <th className="px-3 py-2 text-left">Updated</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(leads ?? []).length === 0 && (
                <tr>
                  <td colSpan={role === 'dev' ? 6 : 5} className="px-3 py-6 text-center text-gray-500">No leads yet.</td>
                </tr>
              )}
              {(leads ?? []).map((l: any) => {
                const name = l.golden_record?.name ?? l.slug ?? '—'
                const updated = l.updated_at ? new Date(l.updated_at).toLocaleString() : '—'
                const grComplete = auditedLeadIds.has(l.id)
                const initiated = Boolean(l.agreement_id) || ['agreed', 'paid'].includes(l.status)
                const agr = l.agreement_id ? agreementsMap.get(l.agreement_id) : undefined
                const responded = agr ? (Boolean(agr.signed_at) || ['signed','accepted','agreed','approved','completed','checked'].includes((agr.status ?? '').toLowerCase())) : false
                const paid = l.payment_id ? (Boolean(paymentsMap.get(l.payment_id)?.paid_at) || ['paid','succeeded'].includes((paymentsMap.get(l.payment_id)?.status ?? ''))) : false
                const gr = l.golden_record ?? {}
                const prefillName = gr.name ?? ''
                const prefillAddress = gr.address ?? ''
                const prefillPhone = (Array.isArray(gr.phones) && gr.phones.length ? (gr.phones[0] ?? '') : (gr.phone ?? '')) as string
                return (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2">{name}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {/* GR status */}
                        {grComplete ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">GR OK</span>
                        ) : (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">No Audit</span>
                        )}
                        {/* Initiated state: red (not initiated), yellow (sent, no response), green (responded, unpaid) */}
                        {!initiated && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">Initiated</span>
                        )}
                        {initiated && !responded && (
                          <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-800">Initiated</span>
                        )}
                        {responded && !paid && (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">Initiated</span>
                        )}
                        {/* Payment state */}
                        {paid ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">Payment</span>
                        ) : (
                          responded && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">Payment</span>
                          )
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">{l.source ?? '—'}</td>
                    {role === 'dev' && (
                      <td className="px-3 py-2">
                        <form action={assignLeadOwner} className="flex items-center gap-2">
                          <input type="hidden" name="lead_id" value={l.id} />
                          <AssignOwnerSelect options={assignOptions} value={l.owner_id ?? l.ambassador_id ?? null} />
                        </form>
                      </td>
                    )}
                    <td className="px-3 py-2">{updated}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {!grComplete && (
                          <Link
                            href={`/dashboard/audit/search?name=${encodeURIComponent(prefillName)}&address=${encodeURIComponent(prefillAddress)}&phone=${encodeURIComponent(prefillPhone)}&leadId=${encodeURIComponent(l.id)}&goto=audit`}
                            className="text-blue-600 hover:underline"
                          >
                            Audit
                          </Link>
                        )}
                        <Link href={`/pipeline/leads/${l.id}/edit`} className="text-blue-600 hover:underline">Edit</Link>
                        {!initiated && (
                          <Link href={`/offer/${l.id}`} className="text-blue-600 hover:underline">
                            Initiate
                          </Link>
                        )}
                        {!paid && (
                          <form action={createPayment}>
                            <input type="hidden" name="lead_id" value={l.id} />
                            <button className="text-blue-600 hover:underline">Manual Payment</button>
                          </form>
                        )}
                        
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Clients */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-700">Clients</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.length === 0 && (
            <div className="rounded border p-4 text-sm text-gray-500">No clients yet.</div>
          )}
          {clients.map((b) => (
            <div key={b.id} className="rounded border p-4">
              <div className="text-sm text-gray-500">{b.slug}</div>
              <div className="mt-1 text-lg font-semibold">{b.name ?? 'Unnamed'}</div>
              <div className="mt-1 text-xs text-gray-500">Health: {b.health_score ?? '—'}</div>
              <div className="mt-1 text-xs text-gray-500">Updated: {b.updated_at ? new Date(b.updated_at).toLocaleString() : '—'}</div>
              <div className="mt-3">
                <Link href={`/status/${b.slug}`} className="text-xs text-blue-600 hover:underline">Open Status</Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
