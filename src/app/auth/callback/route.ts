import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Handle Magic Link (token_hash) and OAuth/email code exchange on the server to
// avoid PKCE localStorage issues. Falls back to client page only if needed.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  const errorDesc = url.searchParams.get('error_description') || url.searchParams.get('error_description[]')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') || 'magiclink'
  const code = url.searchParams.get('code')
  const email = url.searchParams.get('email')

  if (error) {
    const params = new URLSearchParams()
    params.set('error', error)
    if (errorDesc) params.set('message', errorDesc)
    return NextResponse.redirect(new URL(`/login?${params.toString()}`, request.url))
  }

  const supabase = createClient()

  try {
    if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as any })
      if (error) throw error
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    // Magic link style callback sometimes sends code+email+type; verify via OTP
    if (code && email && ['magiclink', 'recovery', 'invite', 'signup', 'email_change'].includes(type)) {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: type as any })
      if (error) throw error
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    // OAuth PKCE code exchange (e.g., Google) only when we are confident it's an OAuth flow.
    // If code is present without token_hash and without email+type, forward to client to use PKCE verifier.
    if (code) {
      if (!tokenHash && !(email && type)) {
        const forwardUrl = new URL(`/auth/callback/complete${url.search}`, request.url)
        return NextResponse.redirect(forwardUrl, { status: 307 })
      }
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) throw error
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  } catch (e: any) {
    const params = new URLSearchParams({ error: 'auth', message: e.message ?? 'Authentication failed' })
    return NextResponse.redirect(new URL(`/login?${params.toString()}`, request.url))
  }

  // No recognizable params: forward to client as a fallback (preserves query)
  const forwardUrl = new URL(`/auth/callback/complete${url.search}`, request.url)
  return NextResponse.redirect(forwardUrl, { status: 307 })
}
