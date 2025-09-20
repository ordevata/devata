import { api } from './api'
import type {
  BookingRequest,
  BookingResponse,
  Center,
  Service,
  Slot,
  Specialist
} from './booking-types'
import { demoCenters, demoServices, demoSpecialists, getDemoSlots } from './demo-data'

export type { PaymentPolicy, BookingRequest, BookingResponse, Center, Service, Slot, Specialist } from './booking-types'

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

function filterDemoSlots({ centerId, serviceId, specialistId, from, to }: SlotQuery): Slot[] {
  const slots = getDemoSlots()
  const fromMs = from ? Date.parse(from) : undefined
  const toMs = to ? Date.parse(to) : undefined

  return slots.filter((slot) => {
    if (slot.centerId !== centerId) return false
    if (slot.serviceId !== serviceId) return false
    if (slot.specialistId !== specialistId) return false
    if (fromMs && Date.parse(slot.end) < fromMs) return false
    if (toMs && Date.parse(slot.start) > toMs) return false
    return true
  })
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

  return fetchWithFallback(`/booking/slots?${search.toString()}`, () => filterDemoSlots(query))
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
      return {
        bookingId: `demo-${Date.now()}`,
        status: 'simulated',
        slotStart,
        slotEnd
      }
    }
    throw error instanceof Error ? error : new Error('Не удалось создать бронь')
  }
}
