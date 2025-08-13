import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { updateLeadGoldenRecord } from '../../../actions'

export const dynamic = 'force-dynamic'

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Edit Lead</h1>
        <p className="mt-2 text-sm text-gray-600">Please sign in.</p>
      </main>
    )
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, slug, golden_record')
    .eq('id', id)
    .maybeSingle()

  if (!lead) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Edit Lead</h1>
        <p className="mt-2 text-sm text-gray-600">Lead not found or access denied.</p>
      </main>
    )
  }

  const gr = (lead as any).golden_record || {}

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Edit Lead</h1>
      <p className="mt-2 text-sm text-gray-600">Update the Golden Record.</p>

      <form action={updateLeadGoldenRecord} className="mt-6 grid grid-cols-1 gap-4">
        <input type="hidden" name="lead_id" value={lead.id} />
        <div>
          <label className="block text-sm font-medium">Business Name *</label>
          <input name="name" defaultValue={gr.name ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium">Industry</label>
          <input name="industry" defaultValue={gr.industry ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium">Address *</label>
          <input name="address" defaultValue={gr.address ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Phone *</label>
            <input name="phone" defaultValue={(gr.phones?.[0]) ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Email *</label>
            <input name="email" type="email" defaultValue={(gr.emails?.[0]) ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Website</label>
          <input name="website" defaultValue={gr.website ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Contact Name</label>
            <input name="contact_name" defaultValue={gr.contact_name ?? ''} className="mt-1 w-full rounded border px-3 py-2" placeholder="Jane Smith" />
          </div>
          <div>
            <label className="block text-sm font-medium">Contact Position</label>
            <input name="contact_position" defaultValue={gr.contact_position ?? ''} className="mt-1 w-full rounded border px-3 py-2" placeholder="Owner / Manager" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Facebook</label>
            <input name="facebook" defaultValue={gr.socials?.facebook ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Instagram</label>
            <input name="instagram" defaultValue={gr.socials?.instagram ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Twitter/X</label>
            <input name="twitter" defaultValue={gr.socials?.twitter ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">YouTube</label>
            <input name="youtube" defaultValue={gr.socials?.youtube ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">LinkedIn</label>
            <input name="linkedin" defaultValue={gr.socials?.linkedin ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">TikTok</label>
            <input name="tiktok" defaultValue={gr.socials?.tiktok ?? ''} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button className="rounded bg-blue-600 px-4 py-2 text-white">Save Changes</button>
          <Link href="/pipeline" className="text-sm text-gray-600 hover:underline">Cancel</Link>
        </div>
      </form>
    </main>
  )
}
