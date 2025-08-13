import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'

// Ensure this page is always rendered dynamically so role/status reflect latest DB changes
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile, error: profileError } = user
    ? await supabase.from('profiles').select('role, full_name, status').eq('id', user.id).maybeSingle()
    : { data: null as any, error: null as any }

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
            <div className="mt-2 text-xs text-gray-600">
              <p>User ID: {user.id}</p>
              <p>Profile row: {profile ? 'found' : 'none'}</p>
              {profileError && <p className="text-red-600">Profile error: {profileError.message}</p>}
            </div>
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
