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
  const limitParam = searchParams.get('limit') ?? undefined

  if (!centerId || !serviceId || !specialistId) {
    return NextResponse.json(
      { error: 'center_id, service_id и specialist_id обязательны' },
      { status: 400 }
    )
  }

  if (from) {
    const parsed = Date.parse(from)
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: 'Параметр from должен быть в формате ISO 8601' }, { status: 400 })
    }
  }

  if (to) {
    const parsed = Date.parse(to)
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: 'Параметр to должен быть в формате ISO 8601' }, { status: 400 })
    }
  }

  let limit: number | undefined
  if (limitParam) {
    const parsedLimit = Number.parseInt(limitParam, 10)
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return NextResponse.json(
        { error: 'Параметр limit должен быть положительным целым числом' },
        { status: 400 }
      )
    }
    limit = parsedLimit
  }

  const slots = getDemoSlots({
    centerId,
    serviceId,
    specialistId,
    from,
    to,
    limit
  })

  return NextResponse.json(slots, {
    headers: { 'Cache-Control': 'no-store' }
  })
}
