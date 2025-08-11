import SignOutButton from '@/components/SignOutButton'

export default function DeniedPage() {
  return (
    <main className="mx-auto max-w-xl p-6 text-center">
      <h1 className="text-2xl font-semibold">Access Denied</h1>
      <p className="mt-3 text-sm text-gray-600">
        Your account has been denied. If you believe this is a mistake, please contact support
        or your PageOne contact.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <SignOutButton />
      </div>
    </main>
  )
}
