import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import UserMenuClient from './UserMenuClient'

export default async function UserMenu() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return (
      <div>
        <Link href="/login" className="text-sm text-blue-600 hover:underline">Sign in</Link>
      </div>
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  const fullName = profile?.full_name || user.email || 'User'
  const email = user.email || ''
  const role = (profile?.role as string | null) ?? 'none'

  return <UserMenuClient fullName={fullName} email={email} role={role} />
}
