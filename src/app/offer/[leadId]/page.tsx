import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function getLeadForOffer(leadId: string) {
  const supabase = await createClient()
  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, slug, status, golden_record, ambassador_id, agreement_id, payment_id, business_id')
    .eq('id', leadId)
    .maybeSingle()
  if (error || !lead) throw new Error('Lead not found')
  return lead as any
}

export default async function OfferPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const lead = await getLeadForOffer(leadId)

  // Minimal eligibility check: require auth and (if emails exist) email match
  if (!user) {
    // Send to sign-in; after sign-in, return here
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    redirect(`/auth/sign-in?redirect_to=${encodeURIComponent(`${base}/offer/${leadId}`)}`)
  }

  const emails: string[] = Array.isArray(lead.golden_record?.emails)
    ? lead.golden_record.emails
    : (lead.golden_record?.email ? [lead.golden_record.email] : [])

  const emailAllowed = emails.length === 0 || emails.includes(user!.email ?? '')

  async function agreeAndCheckout(formData: FormData) {
    'use server'
    const amtCents = 47900
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Upsert a signed agreement and set lead to agreed
    const { data: existing } = await supabase
      .from('agreements')
      .select('id, status')
      .eq('lead_id', leadId)
      .maybeSingle()

    let agreementId = existing?.id as string | undefined
    if (!agreementId) {
      const { data: a } = await supabase
        .from('agreements')
        .insert({ lead_id: leadId, status: 'signed', signed_at: new Date().toISOString() })
        .select('id')
        .single()
      agreementId = a?.id
    } else if (existing?.status !== 'signed') {
      await supabase
        .from('agreements')
        .update({ status: 'signed', signed_at: new Date().toISOString() })
        .eq('id', agreementId)
    }

    await supabase
      .from('leads')
      .update({ agreement_id: agreementId, status: 'agreed' })
      .eq('id', leadId)

    // Create payment row
    const { data: payment } = await supabase
      .from('payments')
      .insert({ lead_id: leadId, provider: 'stripe', amount_cents: amtCents, currency: 'AUD', status: 'pending' })
      .select('id')
      .single()

    const secret = process.env.STRIPE_SECRET_KEY
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    if (secret) {
      const { default: Stripe } = await import('stripe')
      // Align API version across app
      // @ts-ignore
      const stripe = new Stripe(secret, { apiVersion: '2023-10-16' })
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'aud',
              product_data: { name: 'PageOne 90-day trial' },
              unit_amount: amtCents,
            },
            quantity: 1,
          },
        ],
        customer_email: user.email ?? undefined,
        success_url: `${baseUrl}/pipeline?paid=1`,
        cancel_url: `${baseUrl}/offer/${leadId}?canceled=1`,
        metadata: { lead_id: leadId, payment_id: payment?.id ?? '', client_user_id: user.id },
      })
      // Persist session_id for webhook correlation
      if (session.id && payment?.id) {
        await supabase
          .from('payments')
          .update({ session_id: session.id })
          .eq('id', payment.id)
      }
      if (session.url) redirect(session.url)
    }

    // No Stripe configured, return to pipeline
    redirect('/pipeline')
  }

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-2xl font-semibold">PageOne Offer</h1>
      <p className="mt-2 text-sm text-gray-600">90-day trial · $479 AUD once-off</p>

      {!emailAllowed && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          This link isn’t associated with your email.
        </div>
      )}

      <section className="mt-6 rounded border p-4">
        <h2 className="text-lg font-medium">Agreement</h2>
        <p className="mt-2 text-sm text-gray-600">
          By continuing, you agree to the PageOne 90-day trial terms and authorize a $479 AUD payment.
        </p>
        <form action={agreeAndCheckout} className="mt-4">
          <button className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50" disabled={!emailAllowed}>
            Agree & Pay
          </button>
        </form>
      </section>

      <div className="mt-6 text-xs text-gray-500">
        Lead: {lead.golden_record?.name ?? lead.slug ?? lead.id}
      </div>
    </main>
  )
}
