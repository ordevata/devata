import { NextRequest, NextResponse } from 'next/server'

import { createDemoBooking, DemoBookingError, queryDemoBookings } from '@/lib/demo-data'
import type { BookingListFilters, BookingRequest, BookingStatus } from '@/lib/booking-types'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUSES: BookingStatus[] = [
  'reserved',
  'expired',
  'confirmed',
  'checked_in',
  'completed',
  'no_show',
  'canceled',
  'simulated'
]

function validatePayload(payload: BookingRequest) {
  if (!payload.centerId) throw new Error('centerId обязателен')
  if (!payload.serviceId) throw new Error('serviceId обязателен')
  if (!payload.specialistId) throw new Error('specialistId обязателен')
  if (!payload.slotId) throw new Error('slotId обязателен')
  if (!payload.client?.fullName) throw new Error('fullName обязателен')
  if (!payload.client?.phone) throw new Error('phone обязателен')
}

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const filters: BookingListFilters = {}

  const centerId = searchParams.get('center_id') ?? undefined
  const serviceId = searchParams.get('service_id') ?? undefined
  const specialistId = searchParams.get('specialist_id') ?? undefined
  const phone = searchParams.get('phone') ?? undefined
  const email = searchParams.get('email') ?? undefined

  if (centerId) filters.centerId = centerId
  if (serviceId) filters.serviceId = serviceId
  if (specialistId) filters.specialistId = specialistId
  if (phone) filters.phone = phone
  if (email) filters.email = email

  const statusParams = searchParams.getAll('status')
  const statuses = statusParams.filter((value): value is BookingStatus =>
    ALLOWED_STATUSES.includes(value as BookingStatus)
  )
  if (statuses.length) {
    filters.status = Array.from(new Set(statuses))
  }

  const bookings = queryDemoBookings(filters)

  return NextResponse.json(
    {
      bookings,
      total: bookings.length,
      generatedAt: new Date().toISOString()
    },
    {
      headers: { 'Cache-Control': 'no-store' }
    }
  )
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
        slotEnd: booking.slotEnd,
        payment: booking.payment,
        funds: booking.funds,
        updatedAt: booking.updatedAt,
        statusHistory: booking.statusHistory
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
