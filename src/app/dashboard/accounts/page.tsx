import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { setRole, clearRole, setStatus } from './actions'

export const dynamic = 'force-dynamic'

async function requireDev() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { allowed: false as const, reason: 'no-user' }
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (profile?.role !== 'dev') return { allowed: false as const, reason: 'not-dev' }
  return { allowed: true as const }
}

export default async function AccountsPage() {
  const gate = await requireDev()
  if (!gate.allowed) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="mt-2 text-sm text-gray-600">You are not authorized to view this page.</p>
      </main>
    )
  }

  const admin = createAdminClient()
  const [{ data: profilesRes }, usersRes] = await Promise.all([
    admin.from('profiles').select('id, full_name, role, status'),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  ])

  const profiles = profilesRes ?? []
  const users = usersRes.data?.users ?? []

  type Row = { id: string; email: string | null; full_name: string | null; role: 'dev' | 'ambassador' | 'client' | null; status: 'pending' | 'approved' | 'denied' }
  const rows: Row[] = users.map(u => {
    const p = profiles.find(pp => pp.id === u.id)
    return {
      id: u.id,
      email: u.email ?? null,
      full_name: (p as any)?.full_name ?? null,
      role: (p as any)?.role ?? null,
      status: (p as any)?.status ?? 'pending',
    }
  })

  const groups: Record<'pending' | 'approved' | 'denied', Row[]> = { pending: [], approved: [], denied: [] }
  for (const r of rows) groups[r.status].push(r)

  const Section = ({ title, data }: { title: string, data: Row[] }) => (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">{title} <span className="text-xs text-gray-500">({data.length})</span></h2>
      <div className="mt-3 divide-y rounded border">
        {data.length === 0 && (
          <div className="p-3 text-sm text-gray-500">None</div>
        )}
        {data.map(u => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{u.full_name || u.email || u.id}</p>
              <p className="truncate text-xs text-gray-500">{u.email}</p>
              <p className="truncate text-xs text-gray-600">Status: <span className="font-medium">{u.status}</span> · Role: <span className="font-medium">{u.role ?? 'none'}</span></p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Status controls */}
              <form action={setStatus.bind(null, u.id, 'approved')}>
                <button className="rounded border px-2 py-1 text-xs">Approve</button>
              </form>
              <form action={setStatus.bind(null, u.id, 'denied')}>
                <button className="rounded border px-2 py-1 text-xs">Deny</button>
              </form>
              <form action={setStatus.bind(null, u.id, 'pending')}>
                <button className="rounded border px-2 py-1 text-xs">Set Pending</button>
              </form>
              {/* Approvals */}
              <form action={setRole.bind(null, u.id, 'dev')}>
                <button className="rounded border px-2 py-1 text-xs">Make Dev</button>
              </form>
              <form action={setRole.bind(null, u.id, 'ambassador')}>
                <button className="rounded border px-2 py-1 text-xs">Make Ambassador</button>
              </form>
              <form action={setRole.bind(null, u.id, 'client')}>
                <button className="rounded border px-2 py-1 text-xs">Make Client</button>
              </form>
              {/* Deny / clear role */}
              <form action={clearRole.bind(null, u.id)}>
                <button className="rounded border px-2 py-1 text-xs text-red-700">Clear Role</button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </section>
  )

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Accounts</h1>
      <p className="mt-2 text-sm text-gray-600">Approve or deny users and manage roles. Status is independent of role.</p>
      <Section title="Pending" data={groups.pending} />
      <Section title="Approved" data={groups.approved} />
      <Section title="Denied" data={groups.denied} />
    </main>
  )
}
