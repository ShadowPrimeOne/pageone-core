import Link from 'next/link'
import { createLead } from '../../actions'

export const dynamic = 'force-dynamic'

export default async function NewLeadPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Add Lead</h1>
      <p className="mt-2 text-sm text-gray-600">Create a Golden Record. Required: Business Name, Address, Phone, Email. Optional: Contact Name, Position.</p>

      <form action={createLead} className="mt-6 grid grid-cols-1 gap-4">
        <div>
          <label className="block text-sm font-medium">Business Name *</label>
          <input name="name" required className="mt-1 w-full rounded border px-3 py-2" placeholder="Acme Pty Ltd" />
        </div>
        <div>
          <label className="block text-sm font-medium">Industry</label>
          <input name="industry" className="mt-1 w-full rounded border px-3 py-2" placeholder="Plumbing" />
        </div>
        <div>
          <label className="block text-sm font-medium">Address *</label>
          <input name="address" required className="mt-1 w-full rounded border px-3 py-2" placeholder="123 Example St, Sydney NSW" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Phone *</label>
            <input name="phone" required className="mt-1 w-full rounded border px-3 py-2" placeholder="+61 4 1234 5678" />
          </div>
          <div>
            <label className="block text-sm font-medium">Email *</label>
            <input name="email" type="email" required className="mt-1 w-full rounded border px-3 py-2" placeholder="owner@example.com" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Website</label>
          <input name="website" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://example.com" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Contact Name</label>
            <input name="contact_name" className="mt-1 w-full rounded border px-3 py-2" placeholder="Jane Smith" />
          </div>
          <div>
            <label className="block text-sm font-medium">Contact Position</label>
            <input name="contact_position" className="mt-1 w-full rounded border px-3 py-2" placeholder="Owner / Manager" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Facebook</label>
            <input name="facebook" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://facebook.com/yourpage" />
          </div>
          <div>
            <label className="block text-sm font-medium">Instagram</label>
            <input name="instagram" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://instagram.com/yourhandle" />
          </div>
          <div>
            <label className="block text-sm font-medium">Twitter/X</label>
            <input name="twitter" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://twitter.com/yourhandle" />
          </div>
          <div>
            <label className="block text-sm font-medium">YouTube</label>
            <input name="youtube" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://youtube.com/@yourchannel" />
          </div>
          <div>
            <label className="block text-sm font-medium">LinkedIn</label>
            <input name="linkedin" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://linkedin.com/company/yourco" />
          </div>
          <div>
            <label className="block text-sm font-medium">TikTok</label>
            <input name="tiktok" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://tiktok.com/@yourhandle" />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button className="rounded bg-blue-600 px-4 py-2 text-white">Save Lead</button>
          <Link href="/pipeline" className="text-sm text-gray-600 hover:underline">Cancel</Link>
        </div>
      </form>
    </main>
  )
}
