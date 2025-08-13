export default function Loading() {
  return (
    <main className="p-6">
      <div className="h-6 w-56 animate-pulse rounded bg-gray-200" />
      <div className="mt-2 h-4 w-80 animate-pulse rounded bg-gray-100" />

      <section className="mt-6 rounded border p-4">
        <div className="flex items-baseline gap-3">
          <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
          <div className="h-8 w-16 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="mt-2 h-3 w-40 animate-pulse rounded bg-gray-100" />
      </section>

      <section className="mt-6">
        <div className="h-4 w-28 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded border p-4">
              <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
              <div className="mt-2 h-6 w-20 animate-pulse rounded bg-gray-200" />
              <div className="mt-2 h-3 w-28 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <div className="h-4 w-20 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded border bg-gray-50" />
          ))}
        </div>
      </section>
    </main>
  )
}
