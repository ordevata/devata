import { api } from './api'

export type Center = {
  id: string
  name: string
  city: string
  address?: string
  metro?: string
  phone?: string
}

export type Service = {
  id: string
  name: string
  description?: string
  durationMinutes: number
  depositPercent?: number
  centerIds?: string[]
}

export type Specialist = {
  id: string
  fullName: string
  title?: string
  bio?: string
  centerIds: string[]
  serviceIds: string[]
}

export type Slot = {
  id: string
  centerId: string
  serviceId: string
  specialistId: string
  start: string
  end: string
  capacity: number
  remaining: number
  room?: string
  notes?: string
}

export type BookingRequest = {
  centerId: string
  serviceId: string
  specialistId: string
  slotId: string
  client: {
    fullName: string
    phone: string
    email?: string
    comment?: string
    preferredChannel?: 'email' | 'telegram' | 'whatsapp'
  }
  metadata?: Record<string, unknown>
}

export type BookingResponse = {
  bookingId: string
  status: 'reserved' | 'confirmed' | 'simulated'
  slotStart: string
  slotEnd: string
}

const fallbackCenters: Center[] = [
  {
    id: 'center-spb',
    name: 'DEVATA — Санкт-Петербург',
    city: 'Санкт-Петербург',
    address: 'Большой проспект П.С., 29',
    metro: 'Чкаловская',
    phone: '+7 (812) 123-45-67'
  },
  {
    id: 'center-msk',
    name: 'DEVATA — Москва',
    city: 'Москва',
    address: 'Пятницкая улица, 54',
    metro: 'Новокузнецкая',
    phone: '+7 (495) 123-45-67'
  }
]

const fallbackServices: Service[] = [
  {
    id: 'restoration-basic',
    name: 'Кинезиологическое восстановление',
    description: '60-минутная индивидуальная работа со специалистом DEVATA.',
    durationMinutes: 60,
    depositPercent: 30,
    centerIds: ['center-spb', 'center-msk']
  },
  {
    id: 'restoration-advanced',
    name: 'Глубокая восстановительная сессия',
    description: '90 минут, расширенная диагностика и сопровождение.',
    durationMinutes: 90,
    depositPercent: 40,
    centerIds: ['center-spb']
  },
  {
    id: 'diagnostics',
    name: 'Диагностическая консультация',
    description: '45 минут. Первичный анализ состояния и подбор программы.',
    durationMinutes: 45,
    depositPercent: 20,
    centerIds: ['center-msk']
  }
]

const fallbackSpecialists: Specialist[] = [
  {
    id: 'specialist-maria',
    fullName: 'Мария Кузнецова',
    title: 'Ведущий кинезиолог',
    bio: '10 лет практики восстановления. Автор программы «Нейро-ресет».',
    centerIds: ['center-spb'],
    serviceIds: ['restoration-basic', 'restoration-advanced']
  },
  {
    id: 'specialist-ilya',
    fullName: 'Илья Новиков',
    title: 'Кинезиолог, преподаватель DEVATA',
    bio: 'Специализируется на посттравматическом восстановлении и обучении.',
    centerIds: ['center-msk', 'center-spb'],
    serviceIds: ['restoration-basic', 'diagnostics']
  }
]

function buildFallbackSlots(): Slot[] {
  const result: Slot[] = []
  const startFrom = new Date()
  startFrom.setHours(9, 0, 0, 0)

  const hours = [10, 12, 15, 18]
  const daysAhead = 7

  for (const specialist of fallbackSpecialists) {
    const centers = specialist.centerIds.length ? specialist.centerIds : fallbackCenters.map((c) => c.id)
    const services = specialist.serviceIds.length ? specialist.serviceIds : fallbackServices.map((s) => s.id)

    centers.forEach((centerId, centerIndex) => {
      services.forEach((serviceId, serviceIndex) => {
        const service = fallbackServices.find((s) => s.id === serviceId)
        if (!service) return

        for (let day = 0; day < daysAhead; day += 1) {
          for (const hour of hours) {
            const start = new Date(startFrom)
            start.setDate(start.getDate() + day)
            start.setHours(hour, 0, 0, 0)
            const end = new Date(start)
            end.setMinutes(end.getMinutes() + service.durationMinutes)

            const remaining = day === 0 && hour === 15 && serviceIndex === 0 ? 0 : 1

            result.push({
              id: `slot-${specialist.id}-${centerId}-${serviceId}-${day}-${hour}`,
              centerId,
              serviceId,
              specialistId: specialist.id,
              start: start.toISOString(),
              end: end.toISOString(),
              capacity: 1,
              remaining,
              room: centerIndex === 0 ? 'Кабинет 1' : 'Кабинет 2'
            })
          }
        }
      })
    })
  }

  return result
}

const fallbackSlots = buildFallbackSlots()

async function fetchWithFallback<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api(path)
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[booking] Использую демо-данные для ${path}:`, error)
      return fallback
    }
    throw error
  }
}

export async function getCenters(): Promise<Center[]> {
  return fetchWithFallback('/catalog/centers', fallbackCenters)
}

export async function getServices(): Promise<Service[]> {
  return fetchWithFallback('/catalog/services', fallbackServices)
}

export async function getSpecialists(): Promise<Specialist[]> {
  return fetchWithFallback('/catalog/specialists', fallbackSpecialists)
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

  const fromMs = from ? Date.parse(from) : undefined
  const toMs = to ? Date.parse(to) : undefined

  const fallback = fallbackSlots.filter((slot) => {
    if (slot.centerId !== centerId) return false
    if (slot.serviceId !== serviceId) return false
    if (slot.specialistId !== specialistId) return false
    if (fromMs && Date.parse(slot.end) < fromMs) return false
    if (toMs && Date.parse(slot.start) > toMs) return false
    return true
  })

  return fetchWithFallback(`/booking/slots?${search.toString()}`, fallback)
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
      const fallbackSlot = fallbackSlots.find((slot) => slot.id === request.slotId)
      const slotStart = fallbackSlot?.start ?? new Date().toISOString()
      const slotEnd = fallbackSlot?.end ?? new Date(Date.now() + 60 * 60 * 1000).toISOString()
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
