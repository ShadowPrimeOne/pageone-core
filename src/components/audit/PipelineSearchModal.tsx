'use client'

import { useEffect, useState, useCallback } from 'react'
import SearchWidget from '@/components/audit/SearchWidget'

type Props = {
  buttonLabel?: string
  variant?: 'link' | 'button'
  initialName?: string
  initialAddress?: string
  initialPhone?: string
  leadId?: string | null
}

export default function PipelineSearchModal({
  buttonLabel = 'Search',
  variant = 'link',
  initialName = '',
  initialAddress = '',
  initialPhone = '',
  leadId = null,
}: Props) {
  const [open, setOpen] = useState(false)

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onKeyDown])

  return (
    <>
      {variant === 'link' ? (
        <button onClick={() => setOpen(true)} className="text-xs text-blue-600 hover:underline">{buttonLabel}</button>
      ) : (
        <button onClick={() => setOpen(true)} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white">{buttonLabel}</button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-3xl rounded-md border ui-border ui-elevated p-4 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Search Businesses</h3>
              <button onClick={() => setOpen(false)} className="text-sm ui-muted hover:opacity-80">✕</button>
            </div>
            <SearchWidget
              initialName={initialName}
              initialAddress={initialAddress}
              initialPhone={initialPhone}
              leadId={leadId}
              mode="modal"
              onDone={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  )
}
