import { NextRequest, NextResponse } from 'next/server'

import { createDemoBooking, DemoBookingError } from '@/lib/demo-data'
import type { BookingRequest } from '@/lib/booking-types'

export const dynamic = 'force-dynamic'

function validatePayload(payload: BookingRequest) {
  if (!payload.centerId) throw new Error('centerId обязателен')
  if (!payload.serviceId) throw new Error('serviceId обязателен')
  if (!payload.specialistId) throw new Error('specialistId обязателен')
  if (!payload.slotId) throw new Error('slotId обязателен')
  if (!payload.client?.fullName) throw new Error('fullName обязателен')
  if (!payload.client?.phone) throw new Error('phone обязателен')
}

export async function POST(request: NextRequest) {
  let payload: BookingRequest
  try {
    payload = (await request.json()) as BookingRequest
  } catch (error) {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 })
  }

  try {
    validatePayload(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Поля обязательны' },
      { status: 400 }
    )
  }

  try {
    const booking = createDemoBooking(payload)
    return NextResponse.json(
      {
        bookingId: booking.bookingId,
        status: booking.status,
        slotStart: booking.slotStart,
        slotEnd: booking.slotEnd
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof DemoBookingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[booking] Unexpected error', error)
    return NextResponse.json({ error: 'Не удалось создать бронь' }, { status: 500 })
  }
}
