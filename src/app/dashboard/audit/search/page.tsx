'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import SearchWidget from '@/components/audit/SearchWidget'

export default function AuditSearchPage() {
  const searchParams = useSearchParams()
  const leadId = useMemo(() => (searchParams ? (searchParams.get('leadId') || null) : null), [searchParams])
  const initialName = useMemo(() => (searchParams ? (searchParams.get('name') || '') : ''), [searchParams])
  const initialAddress = useMemo(() => (searchParams ? (searchParams.get('address') || '') : ''), [searchParams])
  const initialPhone = useMemo(() => (searchParams ? (searchParams.get('phone') || '') : ''), [searchParams])
  const goToAudit = useMemo(() => (searchParams ? ((searchParams.get('goto') || '').toLowerCase() === 'audit') : false), [searchParams])

  return (
    <SearchWidget
      initialName={initialName}
      initialAddress={initialAddress}
      initialPhone={initialPhone}
      leadId={leadId}
      mode="page"
      pageRedirectTo="/pipeline"
      redirectToAuditOnConfirm={goToAudit}
    />
  )
}
