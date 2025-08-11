import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const path = req.nextUrl.pathname

  // Helper to read status (fallback to 'pending' if missing or blocked by RLS)
  const getStatus = async (): Promise<'approved' | 'pending' | 'denied'> => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('status')
        .eq('id', user!.id)
        .single()
      return (data?.status as any) ?? 'pending'
    } catch {
      return 'pending'
    }
  }

  // Not signed in and trying to access dashboard
  if (path.startsWith('/dashboard') && !user) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  // Signed in: route based on status
  if (user) {
    const status = await getStatus()
    if (path === '/') {
      const target = status === 'approved' ? '/dashboard' : status === 'denied' ? '/denied' : '/pending'
      return NextResponse.redirect(new URL(target, req.url))
    }
    if (path.startsWith('/dashboard')) {
      if (status === 'denied') return NextResponse.redirect(new URL('/denied', req.url))
      if (status !== 'approved') return NextResponse.redirect(new URL('/pending', req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/', '/dashboard/:path*'],
}
