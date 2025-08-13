'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function getActor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = (profile?.role as string | null) ?? null
  return { supabase, user, role }
}

async function ensureLeadAccess(supabase: Awaited<ReturnType<typeof createClient>>, leadId: string, userId: string, role: string | null) {
  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, owner_id, ambassador_id, status, golden_record, business_id')
    .eq('id', leadId)
    .maybeSingle()
  if (error || !lead) throw new Error('Lead not found')
  const isDev = role === 'dev'
  if (!isDev && lead.owner_id !== userId) throw new Error('Forbidden')
  return lead as any
}

export async function createAgreement(formData: FormData) {
  const leadId = String(formData.get('lead_id') || '')
  if (!leadId) throw new Error('lead_id required')
  const { supabase, user, role } = await getActor()
  const lead = await ensureLeadAccess(supabase, leadId, user.id, role)

  // Create agreement row if missing
  let agreementId: string | null = null
  const { data: existing } = await supabase
    .from('agreements')
    .select('id')
    .eq('lead_id', lead.id)
    .maybeSingle()
  if (existing?.id) {
    agreementId = existing.id
  } else {
    const { data: created, error: aErr } = await supabase
      .from('agreements')
      .insert({ lead_id: lead.id, status: 'pending' })
      .select('id')
      .single()
    if (aErr) throw aErr
    agreementId = created.id
  }

  // Advance status to agreed to move pipeline (MVP)
  await supabase
    .from('leads')
    .update({ agreement_id: agreementId, status: 'agreed' })
    .eq('id', lead.id)

  revalidatePath('/pipeline')
}

// Dev-only: Nuke all leads and clients (businesses) for a clean slate
export async function nukeLeadsAndClients() {
  const { supabase, role } = await getActor()
  if (role !== 'dev') throw new Error('Dev only')

  // Delete dependent rows first to satisfy FKs
  await supabase.from('events').delete().eq('subject_type', 'lead')
  await supabase.from('events').delete().eq('subject_type', 'business')
  await supabase.from('onboarding_tasks').delete().gt('created_at', '1970-01-01')
  await supabase.from('lead_audits').delete().gt('created_at', '1970-01-01')
  await supabase.from('agreements').delete().gt('created_at', '1970-01-01')
  await supabase.from('payments').delete().gt('created_at', '1970-01-01')
  await supabase.from('client_accounts').delete().gt('created_at', '1970-01-01')
  // core tables
  await supabase.from('leads').delete().gt('created_at', '1970-01-01')
  await supabase.from('businesses').delete().gt('updated_at', '1970-01-01')

  revalidatePath('/pipeline')
  redirect('/pipeline?nuked=1')
}

export async function createPayment(formData: FormData) {
  const leadId = String(formData.get('lead_id') || '')
  if (!leadId) throw new Error('lead_id required')
  const { supabase, user, role } = await getActor()
  const lead = await ensureLeadAccess(supabase, leadId, user.id, role)

  // Create a pending payment row in AUD for $479 (90-day trial)
  const amount_cents = 47900
  const { data: payment, error: pErr } = await supabase
    .from('payments')
    .insert({ lead_id: lead.id, provider: 'stripe', amount_cents, currency: 'AUD', status: 'pending' })
    .select('id')
    .single()
  if (pErr) throw pErr

  // Attach payment to lead
  await supabase
    .from('leads')
    .update({ payment_id: payment.id })
    .eq('id', lead.id)

  // If Stripe is configured, create a Checkout Session and redirect
  const secret = process.env.STRIPE_SECRET_KEY
  if (secret) {
    const { default: Stripe } = await import('stripe')
    const stripe = new Stripe(secret, { apiVersion: '2023-10-16' })
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'aud',
            product_data: { name: 'PageOne 90-day trial' },
            unit_amount: amount_cents,
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/pipeline?paid=1`,
      cancel_url: `${baseUrl}/pipeline?canceled=1`,
      metadata: { lead_id: lead.id, payment_id: payment.id },
    })
    // Persist session_id for webhook correlation
    if (session.id) {
      await supabase
        .from('payments')
        .update({ session_id: session.id })
        .eq('id', payment.id)
    }
    if (session.url) redirect(session.url)
  }

  // Fallback: no Stripe configured; stay on page
  revalidatePath('/pipeline')
}

function slugify(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

// Dev-only: Seed 3 demo leads assigned to current dev user (or ambassador)
export async function seedDemoLeads() {
  const { supabase, user, role } = await getActor()
  if (role !== 'dev') throw new Error('Dev only')
  try {
  // Prefer a specific owner by email if present
  const targetEmail = 'shadow.prime.one@gmail.com'
  const { data: target } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('email', targetEmail)
    .maybeSingle()
  const targetId = target?.id ?? null
  // Insert with current dev as owner to satisfy RLS in all environments
  const insertOwnerId = user.id

  const demoLeads = [
    {
      name: 'Shadow Plumbing',
      status: 'prospecting',
      contact_name: 'Alex Prime',
      contact_position: 'Owner',
      address: '100 Pipe Rd, Sydney NSW',
      phone: '+61 400 111 111',
      email: 'plumbing@example.com',
      website: 'https://shadowplumbing.example',
    },
    {
      name: 'Shadow Bakery',
      status: 'prospecting',
      contact_name: 'Casey Prime',
      contact_position: 'Manager',
      address: '200 Bread St, Melbourne VIC',
      phone: '+61 400 222 222',
      email: 'bakery@example.com',
      website: 'https://shadowbakery.example',
    },
    {
      name: 'Shadow Cafe',
      status: 'prospecting',
      contact_name: 'Jordan Prime',
      contact_position: 'Owner',
      address: '300 Bean Ave, Brisbane QLD',
      phone: '+61 400 333 333',
      email: 'cafe@example.com',
      website: 'https://shadowcafe.example',
    },
  ]

  const rows = demoLeads.map((d) => ({
    slug: slugify(d.name),
    owner_id: insertOwnerId,
    ambassador_id: insertOwnerId,
    status: d.status,
    source: 'seed',
    golden_record: {
      name: d.name,
      industry: null,
      address: d.address,
      phones: [d.phone],
      // Ensure conversion/business email is the shadow email for testing
      emails: [targetEmail, d.email],
      website: d.website,
      contact_name: d.contact_name,
      contact_position: d.contact_position,
      socials: {
        facebook: null,
        instagram: null,
        twitter: null,
        youtube: null,
        linkedin: null,
        tiktok: null,
      },
    },
  }))

  // Insert; retry on unique slug conflicts; then optionally reassign to targetId
  for (const r of rows) {
    let insertedId: string | null = null
    for (let attempt = 0; attempt < 5 && !insertedId; attempt++) {
      const payload = attempt === 0 ? r : { ...r, slug: `${r.slug}-${attempt + 1}` }
      const { data, error } = await supabase
        .from('leads')
        .insert(payload)
        .select('id')
        .single()
      if (!error && data?.id) {
        insertedId = data.id
        break
      }
      if ((error as any)?.code !== '23505') {
        throw error
      }
    }
    if (insertedId && targetId && targetId !== insertOwnerId) {
      // Best-effort reassignment; dev policy should permit this
      const { error: updErr } = await supabase
        .from('leads')
        .update({ owner_id: targetId, ambassador_id: targetId })
        .eq('id', insertedId)
      // Ignore permission errors silently for now; keep dev as owner if blocked
      if (updErr && (updErr as any)?.code && (updErr as any).code !== '42501') {
        // If it's not a permission error, surface it
        throw updErr
      }
    }
  }

  revalidatePath('/pipeline')
  redirect('/pipeline?seeded=1')
  } catch (e: any) {
    // Allow Next.js redirect() to propagate (it throws an error with digest 'NEXT_REDIRECT')
    if (e && typeof e === 'object' && 'digest' in e && typeof (e as any).digest === 'string' && (e as any).digest.startsWith('NEXT_REDIRECT')) {
      throw e
    }
    console.error('Seed Demo Leads error:', e)
    const msg = e?.message || e?.error?.message || String(e)
    throw new Error(`Seed failed: ${msg}`)
  }
}

// Dev-only: assign/reassign lead owner to any dev/ambassador
export async function assignLeadOwner(formData: FormData) {
  const { supabase, user, role } = await getActor()
  if (role !== 'dev') throw new Error('Dev only')
  const leadId = String(formData.get('lead_id') || '')
  const assigneeId = String(formData.get('assignee_id') || '')
  if (!leadId || !assigneeId) throw new Error('lead_id and assignee_id required')

  // validate target user role
  const { data: target } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', assigneeId)
    .single()
  if (!target || !['dev','ambassador'].includes(String(target.role))) {
    throw new Error('Assignee must be dev or ambassador')
  }

  const { error } = await supabase
    .from('leads')
    .update({ owner_id: assigneeId, ambassador_id: assigneeId })
    .eq('id', leadId)
  if (error) throw error

  revalidatePath('/pipeline')
}

// Create a business ensuring a unique slug by retrying with numeric suffixes on conflict
async function createBusinessWithUniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
  ownerId: string | null
): Promise<string> {
  const base = slugify(name || 'client')
  // Try base, then -2, -3, ... up to -20
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`
    const { data, error } = await supabase
      .from('businesses')
      .insert({ name, slug, is_public: true, owner_id: ownerId ?? null })
      .select('id')
      .single()
    if (!error && data?.id) return data.id as string
    // Unique violation on slug, try next suffix; otherwise rethrow
    if ((error as any)?.code === '23505') continue
    if (error) throw error
  }
  throw new Error('Could not create business with a unique slug')
}

// Core conversion flow used by actions and (mirrored) webhook
async function convertLeadCore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lead: { id: string; owner_id: string | null; ambassador_id?: string | null; business_id: string | null; golden_record?: any }
) {
  // Ensure business exists
  let businessId = lead.business_id as string | null
  if (!businessId) {
    const name = (lead.golden_record?.name as string | undefined) || 'Client'
    businessId = await createBusinessWithUniqueSlug(supabase, name, lead.owner_id ?? lead.ambassador_id ?? null)
  }

  // Ensure owner_id set on existing business if null
  if (lead.owner_id) {
    await supabase
      .from('businesses')
      .update({ owner_id: lead.owner_id })
      .eq('id', businessId)
      .is('owner_id', null)
  }

  // Sync Business profile and pipeline membership (trial starts at conversion/payment)
  const nowIso = new Date().toISOString()
  const trialEnds = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('businesses')
    .update({
      // keep one source of truth for the business profile
      golden_profile: (lead.golden_record ?? null),
      // move pipeline forward: treated as onboard-ready after payment
      pipeline_stage: 'onboarded',
      membership: 'trial',
      trial_started_at: nowIso,
      trial_ends_at: trialEnds,
    })
    .eq('id', businessId)

  // Ensure membership for owner (ambassador or dev)
  const ownerId = (lead.owner_id ?? lead.ambassador_id) ?? null
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

export async function convertLead(formData: FormData) {
  const leadId = String(formData.get('lead_id') || '')
  if (!leadId) throw new Error('lead_id required')
  const { supabase, user, role } = await getActor()
  const lead = await ensureLeadAccess(supabase, leadId, user.id, role)

  const isDev = role === 'dev'
  if (!isDev && lead.status !== 'paid' && lead.status !== 'agreed') {
    throw new Error('Lead must be agreed or paid to convert')
  }

  await convertLeadCore(supabase, lead)

  revalidatePath('/pipeline')
}

// Create a new lead with Golden Record (ambassador-only)
export async function createLead(formData: FormData) {
  const name = String(formData.get('name') || '').trim()
  const industry = String(formData.get('industry') || '').trim()
  const address = String(formData.get('address') || '').trim()
  const phone = String(formData.get('phone') || '').trim()
  const email = String(formData.get('email') || '').trim()
  const website = String(formData.get('website') || '').trim()
  const facebook = String(formData.get('facebook') || '').trim()
  const instagram = String(formData.get('instagram') || '').trim()
  const twitter = String(formData.get('twitter') || '').trim()
  const youtube = String(formData.get('youtube') || '').trim()
  const linkedin = String(formData.get('linkedin') || '').trim()
  const tiktok = String(formData.get('tiktok') || '').trim()
  const contact_name = String(formData.get('contact_name') || '').trim()
  const contact_position = String(formData.get('contact_position') || '').trim()

  if (!name || !address || !phone || !email) {
    throw new Error('Missing required fields')
  }

  const { supabase, user, role } = await getActor()
  const isAmbassador = role === 'ambassador' || role === 'dev'
  if (!isAmbassador) throw new Error('Forbidden')

  const gr: any = {
    name,
    industry: industry || null,
    address,
    phones: [phone],
    emails: [email],
    website: website || null,
    contact_name: contact_name || null,
    contact_position: contact_position || null,
    socials: {
      facebook: facebook || null,
      instagram: instagram || null,
      twitter: twitter || null,
      youtube: youtube || null,
      linkedin: linkedin || null,
      tiktok: tiktok || null,
    },
  }

  const slug = slugify(name)
  const { data: inserted, error } = await supabase
    .from('leads')
    .insert({ slug, owner_id: user.id, ambassador_id: user.id, golden_record: gr, source: 'manual' })
    .select('id')
    .single()
  if (error) throw error

  revalidatePath('/pipeline')
  redirect('/pipeline')
}

// Update Golden Record for a lead (ambassador owns lead or dev)
export async function updateLeadGoldenRecord(formData: FormData) {
  const leadId = String(formData.get('lead_id') || '')
  if (!leadId) throw new Error('lead_id required')

  const name = String(formData.get('name') || '').trim()
  const industry = String(formData.get('industry') || '').trim()
  const address = String(formData.get('address') || '').trim()
  const phone = String(formData.get('phone') || '').trim()
  const email = String(formData.get('email') || '').trim()
  const website = String(formData.get('website') || '').trim()
  const facebook = String(formData.get('facebook') || '').trim()
  const instagram = String(formData.get('instagram') || '').trim()
  const twitter = String(formData.get('twitter') || '').trim()
  const youtube = String(formData.get('youtube') || '').trim()
  const linkedin = String(formData.get('linkedin') || '').trim()
  const tiktok = String(formData.get('tiktok') || '').trim()
  const contact_name = String(formData.get('contact_name') || '').trim()
  const contact_position = String(formData.get('contact_position') || '').trim()

  const { supabase, user, role } = await getActor()
  const lead = await ensureLeadAccess(supabase, leadId, user.id, role)

  const gr: any = {
    name: name || lead.golden_record?.name || null,
    industry: industry || null,
    address: address || lead.golden_record?.address || null,
    phones: (phone ? [phone] : (lead.golden_record?.phones ?? [])).slice(0, 3),
    emails: (email ? [email] : (lead.golden_record?.emails ?? [])).slice(0, 3),
    website: website || lead.golden_record?.website || null,
    contact_name: contact_name || lead.golden_record?.contact_name || null,
    contact_position: contact_position || lead.golden_record?.contact_position || null,
    socials: {
      facebook: facebook || lead.golden_record?.socials?.facebook || null,
      instagram: instagram || lead.golden_record?.socials?.instagram || null,
      twitter: twitter || lead.golden_record?.socials?.twitter || null,
      youtube: youtube || lead.golden_record?.socials?.youtube || null,
      linkedin: linkedin || lead.golden_record?.socials?.linkedin || null,
      tiktok: tiktok || lead.golden_record?.socials?.tiktok || null,
    },
  }

  await supabase
    .from('leads')
    .update({ golden_record: gr })
    .eq('id', leadId)

  revalidatePath('/pipeline')
  redirect('/pipeline')
}
