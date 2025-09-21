import { api } from './api'
import type {
  BookingListFilters,
  BookingListResponse,
  BookingRecord,
  BookingRequest,
  BookingResponse,
  Center,
  Service,
  Slot,
  Specialist
} from './booking-types'
import {
  calculatePaymentSummary,
  demoCenters,
  demoServices,
  demoSpecialists,
  getDemoSlots,
  queryDemoBookings
} from './demo-data'

export type {
  PaymentPolicy,
  BookingRecord,
  BookingListFilters,
  BookingListResponse,
  BookingRequest,
  BookingResponse,
  BookingPaymentSummary,
  BookingStatus,
  Center,
  Service,
  Slot,
  Specialist,
  ScheduleRule,
  ScheduleException
} from './booking-types'

async function fetchWithFallback<T>(
  path: string,
  fallback: () => T | Promise<T>
): Promise<T> {
  try {
    return await api(path)
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[booking] Использую демо-данные для ${path}:`, error)
      return await fallback()
    }
    throw error
  }
}

export async function getCenters(): Promise<Center[]> {
  return fetchWithFallback('/catalog/centers', () => demoCenters)
}

export async function getServices(): Promise<Service[]> {
  return fetchWithFallback('/catalog/services', () => demoServices)
}

export async function getSpecialists(): Promise<Specialist[]> {
  return fetchWithFallback('/catalog/specialists', () => demoSpecialists)
}

export type SlotQuery = {
  centerId: string
  serviceId: string
  specialistId: string
  from?: string
  to?: string
}

export async function getSlots(query: SlotQuery): Promise<Slot[]> {
  const { centerId, serviceId, specialistId, from, to } = query
  const search = new URLSearchParams({
    center_id: centerId,
    service_id: serviceId,
    specialist_id: specialistId
  })
  if (from) search.set('from', from)
  if (to) search.set('to', to)

  return fetchWithFallback(`/booking/slots?${search.toString()}`, () =>
    getDemoSlots({
      centerId,
      serviceId,
      specialistId,
      from,
      to
    })
  )
}

export async function createBooking(request: BookingRequest): Promise<BookingResponse> {
  try {
    const response = await api('/booking', {
      method: 'POST',
      body: JSON.stringify(request)
    })
    return response as BookingResponse
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[booking] API недоступно, возвращаю симулированный ответ', error)
      const slot = getDemoSlots().find((item) => item.id === request.slotId)
      const slotStart = slot?.start ?? new Date().toISOString()
      const slotEnd = slot?.end ?? new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const service = demoServices.find((item) => item.id === request.serviceId)
      const payment = calculatePaymentSummary(service)
      return {
        bookingId: `demo-${Date.now()}`,
        status: 'simulated',
        slotStart,
        slotEnd,
        payment
      }
    }
    throw error instanceof Error ? error : new Error('Не удалось создать бронь')
  }
}

export async function listBookings(
  filters: BookingListFilters = {}
): Promise<BookingListResponse> {
  const search = new URLSearchParams()

  if (filters.centerId) search.set('center_id', filters.centerId)
  if (filters.serviceId) search.set('service_id', filters.serviceId)
  if (filters.specialistId) search.set('specialist_id', filters.specialistId)
  if (filters.phone) search.set('phone', filters.phone)
  if (filters.email) search.set('email', filters.email)
  if (filters.status?.length) {
    for (const status of filters.status) {
      search.append('status', status)
    }
  }

  const query = search.toString()
  const path = `/booking${query ? `?${query}` : ''}`

  return fetchWithFallback(path, () => {
    const bookings = queryDemoBookings(filters)
    return {
      bookings,
      total: bookings.length,
      generatedAt: new Date().toISOString()
    }
  })
}
