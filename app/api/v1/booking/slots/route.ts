import { NextRequest, NextResponse } from 'next/server'

import { getDemoSlots } from '@/lib/demo-data'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const centerId = searchParams.get('center_id') ?? undefined
  const serviceId = searchParams.get('service_id') ?? undefined
  const specialistId = searchParams.get('specialist_id') ?? undefined
  const from = searchParams.get('from') ?? undefined
  const to = searchParams.get('to') ?? undefined

  if (!centerId || !serviceId || !specialistId) {
    return NextResponse.json(
      { error: 'center_id, service_id и specialist_id обязательны' },
      { status: 400 }
    )
  }

  const fromMs = from ? Date.parse(from) : undefined
  const toMs = to ? Date.parse(to) : undefined

  const slots = getDemoSlots().filter((slot) => {
    if (slot.centerId !== centerId) return false
    if (slot.serviceId !== serviceId) return false
    if (slot.specialistId !== specialistId) return false
    if (fromMs && Date.parse(slot.end) < fromMs) return false
    if (toMs && Date.parse(slot.start) > toMs) return false
    return true
  })

  return NextResponse.json(slots, {
    headers: { 'Cache-Control': 'no-store' }
  })
}
