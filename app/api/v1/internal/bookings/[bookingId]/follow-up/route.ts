import { NextRequest, NextResponse } from 'next/server'

import type { BookingFollowUpRequest } from '@/lib/booking-types'
import {
  BookingNotFoundError,
  DemoBookingError,
  createDemoFollowUpBooking
} from '@/lib/demo-data'

export const dynamic = 'force-dynamic'

const NOTE_MAX_LENGTH = 500

type RouteContext = {
  params: { bookingId: string }
}

function normalizeFollowUpPayload(payload: unknown): BookingFollowUpRequest {
  if (typeof payload !== 'object' || payload == null) {
    throw new Error('Тело запроса должно быть объектом')
  }

  const { slotId, note } = payload as { slotId?: unknown; note?: unknown }

  if (typeof slotId !== 'string' || !slotId.trim()) {
    throw new Error('Поле slotId обязательно')
  }

  if (note != null && typeof note !== 'string') {
    throw new Error('Поле note должно быть строкой')
  }

  if (typeof note === 'string' && note.length > NOTE_MAX_LENGTH) {
    throw new Error(`Примечание не должно превышать ${NOTE_MAX_LENGTH} символов`)
  }

  return {
    slotId: slotId.trim(),
    note: typeof note === 'string' ? note.trim() || undefined : undefined
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch (error) {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })
  }

  let followUp: BookingFollowUpRequest
  try {
    followUp = normalizeFollowUpPayload(payload)
  } catch (validationError) {
    return NextResponse.json(
      {
        error:
          validationError instanceof Error
            ? validationError.message
            : 'Некорректные данные'
      },
      { status: 400 }
    )
  }

  try {
    const booking = createDemoFollowUpBooking(context.params.bookingId, followUp)
    return NextResponse.json(booking, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' }
    })
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return NextResponse.json({ error: 'Бронь не найдена' }, { status: 404 })
    }
    if (error instanceof DemoBookingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }
    console.error('[internal][bookings][follow-up] Не удалось назначить follow-up', error)
    return NextResponse.json(
      { error: 'Не удалось назначить follow-up для брони' },
      { status: 500 }
    )
  }
}
