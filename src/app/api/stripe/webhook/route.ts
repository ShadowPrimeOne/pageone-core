import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// Helper: slugify
function slugify(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

async function upsertBusinessAndConvert(
  lead: { id: string; owner_id?: string | null; ambassador_id?: string | null; business_id: string | null; golden_record?: any },
) {
  const supabase = createAdminClient()

  // Ensure business exists
  let businessId = lead.business_id as string | null
  if (!businessId) {
    const base = slugify((lead.golden_record?.name as string | undefined) || 'client')
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`
      const { data, error } = await supabase
        .from('businesses')
        .insert({ name: lead.golden_record?.name || 'Client', slug, is_public: true, owner_id: (lead.owner_id ?? lead.ambassador_id) ?? null })
        .select('id')
        .single()
      if (!error && data?.id) {
        businessId = data.id as string
        break
      }
      if ((error as any)?.code !== '23505') throw error
    }
    if (!businessId) throw new Error('Could not create business with a unique slug')
  }

  // Ensure owner_id is set/updated to the lead's owner/ambassador
  const ownerId = (lead.owner_id ?? lead.ambassador_id) ?? null
  if (ownerId) {
    await supabase
      .from('businesses')
      .update({ owner_id: ownerId })
      .eq('id', businessId)
  }

  // Align with convertLeadCore: set golden profile, advance pipeline, and start trial
  const nowIso = new Date().toISOString()
  const trialEnds = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('businesses')
    .update({
      golden_profile: (lead.golden_record ?? null),
      pipeline_stage: 'onboarded',
      membership: 'trial',
      trial_started_at: nowIso,
      trial_ends_at: trialEnds,
    })
    .eq('id', businessId)

  // Ensure membership for owner (ambassador or dev)
  if (ownerId) {
    const { data: existingMem } = await supabase
      .from('memberships')
      .select('user_id')
      .eq('user_id', ownerId)
      .eq('business_id', businessId)
      .maybeSingle()
    if (!existingMem) {
      const { error: memErr } = await supabase
        .from('memberships')
        .insert({ user_id: ownerId, business_id: businessId })
      if (memErr && (memErr as any).code !== '23505') throw memErr
    }
  }

  // Link lead and advance status
  await supabase
    .from('leads')
    .update({ business_id: businessId, status: 'converted' })
    .eq('id', lead.id)

  // Seed onboarding task (idempotence not critical for MVP)
  await supabase
    .from('onboarding_tasks')
    .insert({ business_id: businessId, stage: 'setup', title: 'Connect accounts', status: 'todo' })
}

async function handlePaymentSuccess(leadId: string, paymentId: string | null) {
  const supabase = createAdminClient()

  // Mark payment as paid (if we have a payment id)
  if (paymentId) {
    await supabase
      .from('payments')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', paymentId)
  }

  // Mark lead as paid and ensure payment link
  await supabase
    .from('leads')
    .update({ status: 'paid', ...(paymentId ? { payment_id: paymentId } : {}) })
    .eq('id', leadId)

  // Always convert after successful payment (business rule)
  try {
    await supabase.from('events').insert({
      subject_type: 'lead',
      subject_id: leadId as any,
      type: 'conversion:attempt',
      payload: { via: 'stripe_webhook', payment_id: paymentId },
    })
  } catch {}

  // Fetch the latest lead details
  const { data: freshLead } = await supabase
    .from('leads')
    .select('id, owner_id, ambassador_id, business_id, golden_record')
    .eq('id', leadId)
    .single()
  if (freshLead) {
    await upsertBusinessAndConvert(freshLead as any)
    try {
      await supabase.from('events').insert({
        subject_type: 'lead',
        subject_id: leadId as any,
        type: 'conversion:done',
        payload: { business_id: (freshLead as any).business_id ?? null },
      })
    } catch {}
  }
}

export async function POST(req: NextRequest) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const isProd = process.env.NODE_ENV === 'production'
  if (!stripeSecret) {
    return NextResponse.json({ error: 'Stripe secret missing' }, { status: 500 })
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: '2023-10-16' })

  let event: Stripe.Event | null = null
  let rawBuffer: Buffer | null = null
  try {
    rawBuffer = Buffer.from(await req.arrayBuffer())
    if (webhookSecret) {
      const signature = req.headers.get('stripe-signature') || ''
      event = stripe.webhooks.constructEvent(rawBuffer, signature, webhookSecret)
    } else if (!isProd) {
      // Dev fallback: accept unverified JSON payload when no webhook secret is configured
      event = JSON.parse(rawBuffer.toString('utf8')) as Stripe.Event
    } else {
      return NextResponse.json({ error: 'Webhook secret missing' }, { status: 500 })
    }
  } catch (err: any) {
    // In dev, attempt to parse and continue even if signature failed
    if (!isProd && rawBuffer) {
      try {
        event = JSON.parse(rawBuffer.toString('utf8')) as Stripe.Event
      } catch (e: any) {
        return NextResponse.json({ error: `Invalid signature and JSON parse failed: ${e.message}` }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: `Invalid signature: ${err.message}` }, { status: 400 })
    }
  }

  try {
    // Record incoming event for observability
    try {
      const supabase = createAdminClient()
      await supabase.from('events').insert({
        subject_type: 'lead',
        subject_id: '00000000-0000-0000-0000-000000000000',
        type: `stripe:${event.type}`,
        payload: event as any,
      })
    } catch {}

    if (event && event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      let leadId = (session.metadata?.lead_id as string) || ''
      let paymentId = (session.metadata?.payment_id as string) || null
      if (session.id) {
        const supabase = createAdminClient()
        const { data: pay } = await supabase
          .from('payments')
          .select('id, lead_id')
          .eq('session_id', session.id)
          .maybeSingle()
        paymentId = paymentId ?? ((pay as any)?.id ?? null)
        if (!leadId) leadId = ((pay as any)?.lead_id as string) || ''
      }
      // Fallback: if we know paymentId but still lack leadId, fetch it by payment id
      if (!leadId && paymentId) {
        const supabase = createAdminClient()
        const { data: pay2 } = await supabase
          .from('payments')
          .select('lead_id')
          .eq('id', paymentId)
          .maybeSingle()
        leadId = ((pay2 as any)?.lead_id as string) || ''
      }
      if (leadId) await handlePaymentSuccess(leadId, paymentId)
    } else if (event && event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent
      let leadId = (intent.metadata?.lead_id as string) || ''
      let paymentId = (intent.metadata?.payment_id as string) || null
      // Fallback: if paymentId known but leadId missing, derive leadId from payments table
      if (!leadId && paymentId) {
        const supabase = createAdminClient()
        const { data: pay } = await supabase
          .from('payments')
          .select('lead_id')
          .eq('id', paymentId)
          .maybeSingle()
        leadId = ((pay as any)?.lead_id as string) || ''
      }
      if (leadId) await handlePaymentSuccess(leadId, paymentId)
    }
  } catch (e: any) {
    // Log error event; ack to avoid retry storms in dev
    try {
      const supabase = createAdminClient()
      await supabase.from('events').insert({
        subject_type: 'lead',
        subject_id: '00000000-0000-0000-0000-000000000000',
        type: 'stripe:webhook_error',
        payload: { message: e?.message ?? String(e) },
      })
    } catch {}
    return NextResponse.json({ error: e.message }, { status: 200 })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
