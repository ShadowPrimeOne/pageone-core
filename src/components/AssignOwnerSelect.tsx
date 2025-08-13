'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Option = { id: string; label: string }

export default function AssignOwnerSelect({
  options,
  value,
  name = 'assignee_id',
}: {
  options: Option[]
  value: string | null
  name?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string>(value ?? '')
  const ref = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const base = options
    if (!term) return base
    return base.filter(o => o.label.toLowerCase().includes(term))
  }, [q, options])

  const selectedLabel = useMemo(() => {
    if (!selected) return 'Unassigned'
    return options.find(o => o.id === selected)?.label ?? 'Unassigned'
  }, [selected, options])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const submitValue = (val: string) => {
    setSelected(val)
    setOpen(false)
    const form = ref.current?.closest('form') as HTMLFormElement | null
    if (form) {
      const hidden = form.querySelector(`input[name="${name}"]`) as HTMLInputElement | null
      if (hidden) hidden.value = val
      else {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        input.value = val
        form.appendChild(input)
      }
      form.requestSubmit()
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex max-w-[220px] items-center justify-between gap-2 rounded border px-2 py-1 text-left text-xs hover:bg-gray-50"
        onClick={() => setOpen(o => !o)}
      >
        <span className="truncate">{selectedLabel}</span>
        <svg className="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      <input type="hidden" name={name} value={selected} readOnly />
      {open && (
        <div className="absolute z-50 mt-1 w-64 rounded border bg-white p-2 shadow">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search users..."
            className="mb-2 w-full rounded border px-2 py-1 text-xs"
          />
          <div className="max-h-40 overflow-auto rounded border">
            <button
              type="button"
              onClick={() => submitValue('')}
              className={`block w-full px-2 py-1 text-left text-xs hover:bg-gray-50 ${selected === '' ? 'bg-gray-100' : ''}`}
            >
              Unassigned
            </button>
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => submitValue(o.id)}
                className={`block w-full px-2 py-1 text-left text-xs hover:bg-gray-50 ${selected === o.id ? 'bg-gray-100' : ''}`}
              >
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-center text-xs text-gray-500">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
