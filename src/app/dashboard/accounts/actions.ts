'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

export async function setRole(userId: string, role: 'dev' | 'ambassador' | 'client') {
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ role, status: 'approved' as any }).eq('id', userId)
  if (error) {
    console.error('setRole error:', error.message)
    return
  }
  revalidatePath('/dashboard/accounts')
  return
}

export async function clearRole(userId: string) {
  const admin = createAdminClient()
  // Attempt to clear role to represent "pending"; will fail if enum disallows null.
  const { error } = await admin.from('profiles').update({ role: null as any, status: 'pending' as any }).eq('id', userId)
  if (error) {
    console.error('clearRole error:', error.message)
    return
  }
  revalidatePath('/dashboard/accounts')
  return
}

export async function setStatus(userId: string, status: 'pending' | 'approved' | 'denied') {
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ status }).eq('id', userId)
  if (error) {
    console.error('setStatus error:', error.message)
    return
  }
  revalidatePath('/dashboard/accounts')
  return
}
