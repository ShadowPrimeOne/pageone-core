'use client'

import { useState } from 'react'
import SignOutButton from './SignOutButton'

export default function UserMenuClient({ fullName, email, role }:{ fullName: string, email: string, role: string }){
  const [open, setOpen] = useState(false)
  const initials = (fullName || email || 'U')
    .split(' ')
    .map(s => s[0]?.toUpperCase())
    .slice(0,2)
    .join('') || 'U'

  return (
    <div className="relative">
      <button
        aria-label="User menu"
        className="flex items-center gap-2"
        onClick={() => setOpen(o => !o)}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-700">{role || 'none'}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-48 ui-menu">
          <div className="px-3 py-2 text-xs ui-muted">{fullName || email}</div>
          <div className="border-t ui-border" />
          <a href="/dashboard" className="block px-3 py-2 text-sm ui-hover">Profile</a>
          <div className="px-3 py-2"><SignOutButton /></div>
        </div>
      )}
    </div>
  )
}
