import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    redirect('/dashboard')
  }
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Welcome to PageOne</h1>
      <p className="mt-2 text-sm text-gray-600">Sign in to continue.</p>
      <div className="mt-6 space-x-3">
        <Link href="/login" className="underline">Sign in</Link>
        <Link href="/status/demo-business" className="underline">View demo status</Link>
      </div>
    </main>
  )
}
