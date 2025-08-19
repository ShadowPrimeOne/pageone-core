import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'
import UserMenu from '@/components/UserMenu'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'PageOne',
  description: 'PageOne MVP',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen ui-surface">
          <header className="flex items-center justify-between border-b ui-border px-4 py-2">
            <Link href="/" className="text-sm font-semibold">PageOne</Link>
            <UserMenu />
          </header>
          {children}
        </div>
      </body>
    </html>
  )
}
