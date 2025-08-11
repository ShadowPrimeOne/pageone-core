'use client'

import { useState, FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'

export default function LoginPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const search = useSearchParams()
  const qsError = search.get('error')
  const qsMessage = search.get('message')

  const signInWithMagicLink = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      // Persist email locally so callback can verify OTP when provider doesn't include email param
      try { localStorage.setItem('po_otp_email', email) } catch {}
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      })
      if (error) throw error
      setMessage('Check your email for the login link.')
    } catch (err: any) {
      setMessage(err.message ?? 'Failed to send magic link.')
    } finally {
      setLoading(false)
    }
  }

  const signInWithProvider = async (provider: 'google') => {
    setLoading(true)
    setMessage(null)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${location.origin}/auth/callback` },
      })
      if (error) throw error
      // Redirect will occur automatically
    } catch (err: any) {
      setMessage(err.message ?? 'OAuth sign-in failed.')
      setLoading(false)
    }
  }

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-gray-600">Use Magic Link or OAuth.</p>

      {(qsError || qsMessage) && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {qsMessage ?? qsError}
        </div>
      )}

      <form onSubmit={signInWithMagicLink} className="mt-6 space-y-3">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black text-white px-4 py-2 disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Send Magic Link'}
        </button>
      </form>

      <div className="mt-6 space-x-3">
        <button
          onClick={() => signInWithProvider('google')}
          disabled={loading}
          className="rounded border px-4 py-2 disabled:opacity-50"
        >
          Continue with Google
        </button>
      </div>

      {message && <p className="mt-4 text-sm">{message}</p>}
    </main>
  )
}
