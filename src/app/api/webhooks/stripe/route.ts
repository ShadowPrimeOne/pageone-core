import { NextRequest } from 'next/server'
import { POST as StripeWebhookPOST } from '@/app/api/stripe/webhook/route'

export const runtime = 'nodejs'
export async function POST(req: NextRequest) {
  return StripeWebhookPOST(req)
}
