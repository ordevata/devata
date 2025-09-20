import type {
  BookingRequest,
  BookingResponse,
  Center,
  Service,
  Specialist,
  Slot
} from './booking-types'

export const demoCenters: Center[] = [
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

export const demoServices: Service[] = [
  {
    id: 'restoration-basic',
    name: 'Кинезиологическое восстановление',
    description: '60-минутная индивидуальная работа со специалистом DEVATA.',
    durationMinutes: 60,
    price: 6500,
    depositPercent: 30,
    paymentPolicy: 'deposit_required',
    depositDueMinutes: 20,
    centerIds: ['center-spb', 'center-msk']
  },
  {
    id: 'restoration-advanced',
    name: 'Глубокая восстановительная сессия',
    description: '90 минут, расширенная диагностика и сопровождение.',
    durationMinutes: 90,
    price: 8900,
    depositPercent: 40,
    paymentPolicy: 'deposit_required',
    depositDueMinutes: 30,
    centerIds: ['center-spb']
  },
  {
    id: 'diagnostics',
    name: 'Диагностическая консультация',
    description: '45 минут. Первичный анализ состояния и подбор программы.',
    durationMinutes: 45,
    price: 4200,
    depositPercent: 20,
    paymentPolicy: 'deposit_optional',
    depositDueMinutes: 15,
    centerIds: ['center-msk']
  }
]

export const demoSpecialists: Specialist[] = [
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

const slotReservations = new Map<string, number>()

export type DemoBookingRecord = BookingResponse & {
  centerId: string
  serviceId: string
  specialistId: string
  slotId: string
  client: BookingRequest['client']
  createdAt: string
}

export type DemoBookingErrorCode = 'SLOT_NOT_FOUND' | 'SLOT_MISMATCH' | 'SLOT_UNAVAILABLE'

export class DemoBookingError extends Error {
  code: DemoBookingErrorCode
  status: number

  constructor(code: DemoBookingErrorCode, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

const demoBookings: DemoBookingRecord[] = []

function buildDemoSlots(): Slot[] {
  const result: Slot[] = []
  const startFrom = new Date()
  startFrom.setHours(9, 0, 0, 0)

  const hours = [10, 12, 15, 18]
  const daysAhead = 7

  for (const specialist of demoSpecialists) {
    const centers = specialist.centerIds.length
      ? specialist.centerIds
      : demoCenters.map((center) => center.id)
    const services = specialist.serviceIds.length
      ? specialist.serviceIds
      : demoServices.map((service) => service.id)

    centers.forEach((centerId, centerIndex) => {
      services.forEach((serviceId, serviceIndex) => {
        const service = demoServices.find((item) => item.id === serviceId)
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

export function getDemoSlots(): Slot[] {
  const base = buildDemoSlots()
  return base.map((slot) => {
    const reserved = slotReservations.get(slot.id) ?? 0
    const remaining = Math.max(0, slot.remaining - reserved)
    return {
      ...slot,
      remaining
    }
  })
}

function nextDemoBookingId() {
  return `demo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export function listDemoBookings(): DemoBookingRecord[] {
  return [...demoBookings]
}

export function createDemoBooking(request: BookingRequest): DemoBookingRecord {
  const slots = getDemoSlots()
  const slot = slots.find((item) => item.id === request.slotId)
  if (!slot) {
    throw new DemoBookingError('SLOT_NOT_FOUND', 'Слот не найден', 404)
  }
  if (
    slot.centerId !== request.centerId ||
    slot.serviceId !== request.serviceId ||
    slot.specialistId !== request.specialistId
  ) {
    throw new DemoBookingError('SLOT_MISMATCH', 'Слот не соответствует выбранным значениям', 400)
  }
  if (slot.remaining <= 0) {
    throw new DemoBookingError('SLOT_UNAVAILABLE', 'Слот уже занят', 409)
  }

  const booking: DemoBookingRecord = {
    bookingId: nextDemoBookingId(),
    status: 'confirmed',
    slotStart: slot.start,
    slotEnd: slot.end,
    centerId: request.centerId,
    serviceId: request.serviceId,
    specialistId: request.specialistId,
    slotId: request.slotId,
    client: request.client,
    createdAt: new Date().toISOString()
  }

  demoBookings.push(booking)
  const reserved = slotReservations.get(slot.id) ?? 0
  slotReservations.set(slot.id, reserved + 1)

  return booking
}
