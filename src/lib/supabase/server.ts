import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function createClient() {
  // Next.js 15: cookies() is async; must be awaited.
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // In some render phases, reading cookies may not be available.
          try {
            return cookieStore.getAll()
          } catch {
            return []
          }
        },
        setAll(cookies) {
          // Only allowed in Server Actions/Route Handlers. In RSC, ignore to avoid runtime errors.
          try {
            cookies.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // no-op in RSC
          }
        },
      },
    }
  )
}
