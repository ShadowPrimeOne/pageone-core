import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role, full_name, status').eq('id', user.id).single()
    : { data: null }

  return (
    <main className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <SignOutButton />
      </div>
      <div className="mt-4">
        {user ? (
          <div>
            <p className="text-sm">Signed in as {user.email}</p>
            <p className="mt-1 text-sm">Status: {profile?.status ?? 'pending'}</p>
            <p className="mt-1 text-sm">Role: {profile?.role ?? 'none'}</p>
            {profile?.role === 'dev' && (
              <div className="mt-4">
                <Link href="/dashboard/accounts" className="underline">Open Accounts</Link>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm">Not signed in.</p>
        )}
      </div>
    </main>
  )
}
