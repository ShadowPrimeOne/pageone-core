import { createClient as createBase } from '@supabase/supabase-js'

// Server-only admin client using service role key. Do NOT import in client components.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE
  if (!serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE)')
  }
  return createBase(url, serviceKey, { auth: { persistSession: false } })
}
