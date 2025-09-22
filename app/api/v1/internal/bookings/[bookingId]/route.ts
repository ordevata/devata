import { NextRequest, NextResponse } from 'next/server'

import {
  BookingNotFoundError,
  BookingStatusTransitionError,
  getDemoBookingById,
  updateDemoBookingStatus
} from '@/lib/demo-data'
import type { BookingStatus } from '@/lib/booking-types'

export const dynamic = 'force-dynamic'

const MANAGEABLE_STATUSES: BookingStatus[] = [
  'reserved',
  'confirmed',
  'checked_in',
  'completed',
  'canceled',
  'no_show',
  'expired'
]

const NOTE_MAX_LENGTH = 500

type RouteContext = {
  params: { bookingId: string }
}

export function GET(_: NextRequest, context: RouteContext) {
  const booking = getDemoBookingById(context.params.bookingId)
  if (!booking) {
    return NextResponse.json({ error: 'Бронь не найдена' }, { status: 404 })
  }

  return NextResponse.json(booking, {
    headers: { 'Cache-Control': 'no-store' }
  })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch (error) {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })
  }

  if (typeof payload !== 'object' || payload == null) {
    return NextResponse.json({ error: 'Тело запроса должно быть объектом' }, { status: 400 })
  }

  const { status, note } = payload as {
    status?: BookingStatus | string
    note?: unknown
  }

  if (!status || typeof status !== 'string') {
    return NextResponse.json({ error: 'Поле status обязательно' }, { status: 400 })
  }

  const normalizedStatus = status as BookingStatus
  if (!MANAGEABLE_STATUSES.includes(normalizedStatus)) {
    return NextResponse.json({ error: 'Недопустимый статус' }, { status: 400 })
  }

  if (note != null && typeof note !== 'string') {
    return NextResponse.json({ error: 'Поле note должно быть строкой' }, { status: 400 })
  }

  if (typeof note === 'string' && note.length > NOTE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Примечание не должно превышать ${NOTE_MAX_LENGTH} символов` },
      { status: 400 }
    )
  }

  try {
    const booking = updateDemoBookingStatus(context.params.bookingId, normalizedStatus, {
      note: typeof note === 'string' ? note.trim() || undefined : undefined
    })

    return NextResponse.json(booking, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return NextResponse.json({ error: 'Бронь не найдена' }, { status: 404 })
    }
    if (error instanceof BookingStatusTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[internal][bookings] Не удалось обновить статус', error)
    return NextResponse.json({ error: 'Не удалось обновить статус брони' }, { status: 500 })
  }
}
