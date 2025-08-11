'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackCompletePage() {
  const supabase = createClient()
  const router = useRouter()
  const search = useSearchParams()
  const [message, setMessage] = useState<string | null>(null)
  const [needEmail, setNeedEmail] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const codeParam = search.get('code')
  const typeParam = search.get('type')

  useEffect(() => {
    const handle = async () => {
      try {
        const code = search.get('code')
        const error = search.get('error')
        const errorDesc = search.get('error_description') || search.get('error_description[]')
        const tokenHash = search.get('token_hash')
        const type = search.get('type')
        const emailParam = search.get('email') || (() => { try { return localStorage.getItem('po_otp_email') } catch { return null } })()

        if (error) {
          const params = new URLSearchParams()
          params.set('error', error)
          if (errorDesc) params.set('message', errorDesc)
          router.replace(`/login?${params.toString()}`)
          return
        }

        // Magic link first: if token_hash present, verify OTP (avoids PKCE error)
        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: (type as any) || 'magiclink',
          })
          if (error) throw error
          router.replace('/dashboard')
          return
        }

        // Magic link without token_hash: verify using email+code when a type is present
        if (code && type) {
          if (!emailParam) {
            setNeedEmail(true)
            return
          }
          const { error } = await supabase.auth.verifyOtp({
            email: emailParam,
            token: code,
            type: (type as any) || 'magiclink',
          })
          if (error) throw error
          router.replace('/dashboard')
          return
        }

        // If only a code is present (no token_hash), try magic-link verify first (in case provider omitted type),
        // then fall back to PKCE exchange.
        if (code && !tokenHash && !type) {
          if (emailParam) {
            const verify = await supabase.auth.verifyOtp({
              email: emailParam,
              token: code,
              type: 'magiclink' as any,
            })
            if (!verify.error) {
              router.replace('/dashboard')
              return
            }
          }
          // If email not available, ask user to input
          setNeedEmail(true)
          return
        }

        // No recognizable params; go to login
        router.replace('/login')
      } catch (err: any) {
        setMessage(err.message ?? 'Authentication failed.')
      }
    }

    handle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold">Completing sign in…</h1>
      {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
      {needEmail && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-gray-700">Enter your email to complete the magic link login.</p>
          <input
            type="email"
            className="w-full rounded border px-3 py-2"
            placeholder="you@example.com"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
          />
          <button
            className="rounded bg-black text-white px-4 py-2"
            onClick={async () => {
              try {
                if (!codeParam) {
                  setMessage('Missing code parameter. Please request a new magic link.')
                  return
                }
                const { error } = await supabase.auth.verifyOtp({
                  email: emailInput,
                  token: codeParam,
                  type: (typeParam as any) || 'magiclink',
                })
                if (error) throw error
                router.replace('/dashboard')
              } catch (err: any) {
                setMessage(err.message ?? 'Failed to complete sign in.')
              }
            }}
          >
            Verify & Continue
          </button>
        </div>
      )}
    </main>
  )
}
