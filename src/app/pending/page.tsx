import SignOutButton from '@/components/SignOutButton'

export default function PendingPage() {
  return (
    <main className="mx-auto max-w-xl p-6 text-center">
      <h1 className="text-2xl font-semibold">Account Pending Approval</h1>
      <p className="mt-3 text-sm text-gray-600">
        Thanks for signing up. Your account is currently pending approval by our team. You’ll get access as soon as it’s approved.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <SignOutButton />
      </div>
    </main>
  )
}
