import { createClient as createBase } from '@supabase/supabase-js'

// Server-only admin client using service role key. Do NOT import in client components.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createBase(url, serviceKey, { auth: { persistSession: false } })
}
