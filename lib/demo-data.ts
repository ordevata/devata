import type {
  BookingClient,
  BookingFollowUpRequest,
  BookingListFilters,
  BookingPaymentSummary,
  BookingRecord,
  BookingRequest,
  BookingStatus,
  BookingStatusChange,
  Center,
  Partner,
  PartnerPayoutSnapshot,
  ScheduleException,
  ScheduleRule,
  Service,
  Slot,
  Specialist
} from './booking-types'

import { buildFundsLedger } from './funds-ledger'
import { buildPartnerPayoutSnapshot } from './partner-ledger'

const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 21
const DEFAULT_LIMIT = 90
const MAX_LIMIT = 180
const MOSCOW_TIME_OFFSET_MINUTES = 180
const DEFAULT_RESERVATION_HOLD_MINUTES = 15

type ReservationHold = {
  expiresAt?: number
}

type ReservationState = {
  confirmed: number
  holds: ReservationHold[]
}

const slotReservations = new Map<string, ReservationState>()
let seededReservation = false

type StoredBooking = BookingRecord & {
  statusHistory: BookingStatusChange[]
  updatedAt: string
}

type DemoBookingErrorCode = 'SLOT_NOT_FOUND' | 'SLOT_MISMATCH' | 'SLOT_UNAVAILABLE'
const demoBookings: StoredBooking[] = []
let seededDemoBookingsData = false

function findStoredBooking(bookingId: string): StoredBooking | undefined {
  return demoBookings.find((booking) => booking.bookingId === bookingId)
}

function cloneBooking(booking: StoredBooking): BookingRecord {
  return JSON.parse(JSON.stringify(booking)) as BookingRecord
}

function getReservationEffect(status: BookingStatus): 'none' | 'hold' | 'confirmed' {
  switch (status) {
    case 'reserved':
      return 'hold'
    case 'confirmed':
    case 'checked_in':
      return 'confirmed'
    default:
      return 'none'
  }
}

function applyReservationTransition(
  booking: StoredBooking,
  previousStatus: BookingStatus,
  nextStatus: BookingStatus
) {
  if (previousStatus === nextStatus) return

  const state = getReservationState(booking.slotId)
  const previousEffect = getReservationEffect(previousStatus)
  const nextEffect = getReservationEffect(nextStatus)

  if (previousEffect === 'hold') {
    state.holds = []
  } else if (previousEffect === 'confirmed') {
    state.confirmed = Math.max(0, state.confirmed - 1)
  }

  if (nextEffect === 'hold') {
    state.holds.push({ expiresAt: resolveReservationExpiry(booking.payment, Date.now()) })
  } else if (nextEffect === 'confirmed') {
    state.confirmed = Math.max(0, state.confirmed) + 1
  }

  if (state.confirmed <= 0 && state.holds.length === 0) {
    slotReservations.delete(booking.slotId)
  }
}

function recordStatusChange(
  booking: StoredBooking,
  status: BookingStatus,
  options: { changedAt?: string; note?: string; previousStatus?: BookingStatus } = {}
) {
  const changedAt = options.changedAt ?? new Date().toISOString()
  const entry: BookingStatusChange = {
    status,
    changedAt
  }
  if (options.previousStatus) {
    entry.previousStatus = options.previousStatus
  }
  if (options.note) {
    entry.note = options.note
  }

  booking.status = status
  booking.updatedAt = changedAt
  if (!booking.statusHistory) {
    booking.statusHistory = []
  }
  booking.statusHistory.push(entry)
}

function createStoredBooking(
  booking: Omit<StoredBooking, 'statusHistory' | 'updatedAt'>
): StoredBooking {
  const stored: StoredBooking = {
    ...booking,
    updatedAt: booking.createdAt,
    statusHistory: []
  }
  recordStatusChange(stored, booking.status, { changedAt: booking.createdAt })
  return stored
}

const ALLOWED_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  reserved: ['confirmed', 'canceled', 'expired'],
  confirmed: ['checked_in', 'canceled', 'no_show', 'completed'],
  checked_in: ['completed'],
  completed: [],
  no_show: [],
  canceled: [],
  expired: [],
  simulated: ['confirmed', 'canceled']
}

function normalizePhone(value?: string): string {
  if (!value) return ''
  return value.replace(/[^+\d]/g, '')
}

function normalizeText(value?: string): string {
  return value?.trim().toLowerCase() ?? ''
}

function matchesBookingFilters(booking: BookingRecord, filters: BookingListFilters): boolean {
  if (filters.centerId && booking.centerId !== filters.centerId) return false
  if (filters.serviceId && booking.serviceId !== filters.serviceId) return false
  if (filters.specialistId && booking.specialistId !== filters.specialistId) return false

  if (filters.status?.length && !filters.status.includes(booking.status)) {
    return false
  }

  if (filters.phone) {
    const haystack = normalizePhone(booking.client.phone)
    const needle = normalizePhone(filters.phone)
    if (!haystack.includes(needle)) return false
  }

  if (filters.email) {
    const haystack = normalizeText(booking.client.email)
    const needle = normalizeText(filters.email)
    if (!haystack || !haystack.includes(needle)) return false
  }

  return true
}

function getReservationState(slotId: string): ReservationState {
  let state = slotReservations.get(slotId)
  if (!state) {
    state = { confirmed: 0, holds: [] }
    slotReservations.set(slotId, state)
  }
  return state
}

function pruneExpiredReservations(now: number = Date.now()) {
  for (const [slotId, state] of slotReservations.entries()) {
    if (state.holds.length) {
      state.holds = state.holds.filter((hold) => hold.expiresAt == null || hold.expiresAt > now)
    }
    if (state.confirmed <= 0 && state.holds.length === 0) {
      slotReservations.delete(slotId)
    }
  }

  for (const booking of demoBookings) {
    if (booking.status !== 'reserved') continue
    const dueAt = booking.payment?.depositDueAt
    if (!dueAt) continue
    const dueAtMs = Date.parse(dueAt)
    if (Number.isNaN(dueAtMs)) continue
    if (dueAtMs <= now) {
      applyReservationTransition(booking, 'reserved', 'expired')
      recordStatusChange(booking, 'expired', {
        previousStatus: 'reserved',
        changedAt: new Date(dueAtMs).toISOString(),
        note: 'Дедлайн по депозиту истёк'
      })
    }
  }
}

function resolveReservationExpiry(
  payment: BookingPaymentSummary | undefined,
  now: number
): number | undefined {
  if (!payment) return undefined
  const holdMinutes =
    payment.depositHoldMinutes ??
    (payment.policy === 'full_prepaid' || payment.policy === 'deposit_required'
      ? DEFAULT_RESERVATION_HOLD_MINUTES
      : undefined)
  if (holdMinutes == null) return undefined
  return now + holdMinutes * MS_PER_MINUTE
}

function computeDepositDueAt(
  depositDueMinutes: number | undefined,
  now: Date
): string | undefined {
  if (depositDueMinutes == null) return undefined
  return new Date(now.getTime() + depositDueMinutes * MS_PER_MINUTE).toISOString()
}

export function calculatePaymentSummary(
  service: Service | undefined,
  options: { now?: Date } = {}
): BookingPaymentSummary | undefined {
  if (!service) return undefined

  const now = options.now ?? new Date()
  const policy = service.paymentPolicy ?? 'none'
  const price = service.price
  const depositPercent = service.depositPercent ?? 0
  const depositHoldMinutes =
    service.depositDueMinutes ??
    (policy === 'full_prepaid' || policy === 'deposit_required'
      ? DEFAULT_RESERVATION_HOLD_MINUTES
      : undefined)
  const depositDueAt = computeDepositDueAt(depositHoldMinutes, now)

  let dueNowAmount: number | undefined
  let dueLaterAmount: number | undefined
  let note: string | undefined

  switch (policy) {
    case 'full_prepaid':
      if (price != null) {
        dueNowAmount = price
        dueLaterAmount = 0
      }
      note = 'Для подтверждения записи требуется полная оплата.'
      break
    case 'deposit_required':
      if (price != null) {
        dueNowAmount = Math.min(price, Math.max(0, Math.round((price * depositPercent) / 100)))
        dueLaterAmount = Math.max(0, price - (dueNowAmount ?? 0))
      }
      note = 'Необходимо внести депозит, чтобы удержать слот.'
      break
    case 'deposit_optional':
      if (price != null) {
        dueNowAmount = Math.min(price, Math.max(0, Math.round((price * depositPercent) / 100)))
        dueLaterAmount = Math.max(0, price - (dueNowAmount ?? 0))
      }
      note = 'Депозит можно внести для фиксации времени.'
      break
    default:
      if (price != null) {
        dueLaterAmount = price
      }
      note = 'Оплата производится в день визита.'
      break
  }

  const summary: BookingPaymentSummary = {
    policy,
    currency: 'RUB',
    totalAmount: price,
    isDepositOptional: policy === 'deposit_optional',
    depositHoldMinutes,
    depositDueAt
  }

  if (dueNowAmount != null) {
    if (dueNowAmount > 0 || policy === 'full_prepaid') {
      summary.dueNowAmount = dueNowAmount
    }
  }

  if (dueLaterAmount != null && dueLaterAmount > 0) {
    summary.dueLaterAmount = dueLaterAmount
  }

  if (note) {
    summary.note = note
  }

  return summary
}

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
    specialistSharePercent: 45,
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
    specialistSharePercent: 45,
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
    specialistSharePercent: 45,
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

export const demoPartners: Partner[] = [
  { id: 'partner-stella', fullName: 'Стелла Власова', trained: true },
  { id: 'partner-nikita', fullName: 'Никита Журавлёв', parentId: 'partner-stella', trained: true },
  { id: 'partner-elena', fullName: 'Елена Орлова', parentId: 'partner-nikita', trained: true },
  { id: 'partner-vadim', fullName: 'Вадим Киселёв', parentId: 'partner-elena' },
  { id: 'partner-oksana', fullName: 'Оксана Морозова', parentId: 'partner-vadim', trained: true },
  { id: 'partner-sergey', fullName: 'Сергей Павлов', parentId: 'partner-oksana' }
]

const partnerIndex = new Map(demoPartners.map((partner) => [partner.id, partner]))

function buildReferralPath(rootPartnerId: string, maxDepth = 5): string[] {
  const path: string[] = []
  let currentId: string | undefined = rootPartnerId
  let depth = 0

  while (currentId && depth < maxDepth) {
    const partner = partnerIndex.get(currentId)
    if (!partner) break
    path.push(partner.id)
    currentId = partner.parentId
    depth += 1
  }

  return path
}

const defaultReferralRoots: Record<string, string> = {
  'restoration-basic': 'partner-sergey',
  'restoration-advanced': 'partner-oksana',
  diagnostics: 'partner-vadim'
}

const specialistMentorBySpecialist: Record<string, string> = {
  'specialist-maria': 'partner-elena',
  'specialist-ilya': 'partner-oksana'
}

function resolveReferralPath(request: BookingRequest): string[] {
  const explicitPath = request.referral?.path?.filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (explicitPath && explicitPath.length) {
    return explicitPath.slice(0, 5)
  }

  if (request.referral?.refId) {
    return buildReferralPath(request.referral.refId)
  }

  const defaultRoot = defaultReferralRoots[request.serviceId]
  if (defaultRoot) {
    return buildReferralPath(defaultRoot)
  }

  return []
}

type SeedStatusTransition = {
  status: BookingStatus
  offsetMinutes?: number
  at?: 'slotStart' | 'slotEnd'
  note?: string
}

type SeedBookingConfig = {
  bookingId: string
  initialStatus: BookingStatus
  centerId: string
  serviceId: string
  specialistId: string
  slotOffsetDays: number
  slotOffsetMinutes: number
  client: BookingClient
  referralRoot?: string
  referralPath?: string[]
  transitions?: SeedStatusTransition[]
}

function ensureDemoBookingsSeeded() {
  if (seededDemoBookingsData) return
  if (demoBookings.length > 0) {
    seededDemoBookingsData = true
    return
  }

  const now = new Date()
  const seedConfigs: SeedBookingConfig[] = [
    {
      bookingId: 'demo-booking-anna',
      initialStatus: 'reserved',
      centerId: 'center-spb',
      serviceId: 'restoration-basic',
      specialistId: 'specialist-maria',
      slotOffsetDays: -5,
      slotOffsetMinutes: 10 * 60,
      client: {
        fullName: 'Анна Петрова',
        phone: '+7 (921) 111-22-33',
        email: 'anna@example.com',
        preferredChannel: 'telegram'
      },
      referralRoot: 'partner-sergey',
      transitions: [
        {
          status: 'confirmed',
          offsetMinutes: 120,
          note: 'Оператор подтвердил бронирование после консультации'
        },
        {
          status: 'completed',
          at: 'slotEnd',
          note: 'Визит состоялся и закрыт'
        }
      ]
    },
    {
      bookingId: 'demo-booking-deposit',
      initialStatus: 'reserved',
      centerId: 'center-spb',
      serviceId: 'restoration-advanced',
      specialistId: 'specialist-maria',
      slotOffsetDays: 3,
      slotOffsetMinutes: 12 * 60,
      client: {
        fullName: 'Дмитрий Смирнов',
        phone: '+7 (921) 555-44-66',
        email: 'dmitry@example.com',
        preferredChannel: 'whatsapp'
      },
      referralRoot: 'partner-oksana'
    },
    {
      bookingId: 'demo-booking-diagnostics',
      initialStatus: 'confirmed',
      centerId: 'center-msk',
      serviceId: 'diagnostics',
      specialistId: 'specialist-ilya',
      slotOffsetDays: 7,
      slotOffsetMinutes: 15 * 60,
      client: {
        fullName: 'Мария Соколова',
        phone: '+7 (916) 777-88-44',
        email: 'maria@example.com',
        preferredChannel: 'email'
      },
      referralRoot: 'partner-vadim',
      transitions: [
        {
          status: 'checked_in',
          at: 'slotStart',
          note: 'Клиент отметился на ресепшене'
        }
      ]
    }
  ]

  seedConfigs.forEach((config, index) => {
    const service = demoServices.find((item) => item.id === config.serviceId)
    if (!service) return

    const slotStart = new Date(
      now.getTime() + config.slotOffsetDays * MS_PER_DAY + config.slotOffsetMinutes * MS_PER_MINUTE
    )
    const slotEnd = addMinutes(slotStart, service.durationMinutes).toISOString()
    const createdAt = new Date(slotStart.getTime() - 2 * MS_PER_DAY).toISOString()

    const paymentNow = new Date(slotStart.getTime() - 2 * MS_PER_DAY)
    const payment = calculatePaymentSummary(service, { now: paymentNow })

    if (payment && config.initialStatus === 'reserved') {
      const dueDate = new Date(slotStart.getTime() - 12 * MS_PER_HOUR)
      payment.depositDueAt = dueDate.toISOString()
      payment.depositHoldMinutes = Math.max(payment.depositHoldMinutes ?? 0, Math.ceil(12 * 60))
    }

    const referralPath = config.referralPath ?? (config.referralRoot ? buildReferralPath(config.referralRoot) : [])

    const funds = payment
      ? buildFundsLedger({
          payment,
          referralPath,
          specialistSharePercent: service.specialistSharePercent,
          professionalMentorId: specialistMentorBySpecialist[config.specialistId],
          totalAmountFallback: service.price
        })
      : undefined

    const stored = createStoredBooking({
      bookingId: config.bookingId,
      status: config.initialStatus,
      slotStart: slotStart.toISOString(),
      slotEnd,
      centerId: config.centerId,
      serviceId: config.serviceId,
      specialistId: config.specialistId,
      slotId: `seed-slot-${index + 1}`,
      client: config.client,
      createdAt,
      payment,
      funds
    })

    demoBookings.push(stored)
    applyReservationTransition(stored, 'simulated', stored.status)

    if (config.transitions?.length) {
      const createdAtDate = new Date(createdAt)
      let previousStatus = stored.status
      for (const transition of config.transitions) {
        let changedAt: string
        if (transition.at === 'slotStart') {
          changedAt = slotStart.toISOString()
        } else if (transition.at === 'slotEnd') {
          changedAt = slotEnd
        } else if (transition.offsetMinutes != null) {
          changedAt = new Date(
            createdAtDate.getTime() + transition.offsetMinutes * MS_PER_MINUTE
          ).toISOString()
        } else {
          changedAt = new Date(createdAtDate.getTime() + 5 * MS_PER_MINUTE).toISOString()
        }

        applyReservationTransition(stored, previousStatus, transition.status)
        recordStatusChange(stored, transition.status, {
          previousStatus,
          changedAt,
          note: transition.note
        })

        if (stored.payment && previousStatus === 'reserved' && transition.status === 'confirmed') {
          stored.payment.depositDueAt = undefined
          stored.payment.depositHoldMinutes = undefined
        }

        previousStatus = transition.status
      }
    }
  })

  seededDemoBookingsData = true
}

export const demoScheduleRules: ScheduleRule[] = [
  {
    id: 'rule-maria-basic-weekdays',
    centerId: 'center-spb',
    specialistId: 'specialist-maria',
    serviceId: 'restoration-basic',
    daysOfWeek: [1, 3, 5],
    startTimes: ['10:00', '12:00', '15:00'],
    durationMinutes: 60,
    capacity: 1,
    room: 'Кабинет 1',
    timezoneOffsetMinutes: MOSCOW_TIME_OFFSET_MINUTES,
    validFrom: '2024-01-01T00:00:00+03:00'
  },
  {
    id: 'rule-maria-advanced-evening',
    centerId: 'center-spb',
    specialistId: 'specialist-maria',
    serviceId: 'restoration-advanced',
    daysOfWeek: [2, 4],
    startTimes: ['18:30'],
    durationMinutes: 90,
    capacity: 1,
    room: 'Кабинет 2',
    timezoneOffsetMinutes: MOSCOW_TIME_OFFSET_MINUTES,
    notes: 'Расширенная диагностика и сопровождение',
    validFrom: '2024-01-01T00:00:00+03:00'
  },
  {
    id: 'rule-ilya-msk-basic',
    centerId: 'center-msk',
    specialistId: 'specialist-ilya',
    serviceId: 'restoration-basic',
    daysOfWeek: [2, 4],
    startTimes: ['11:00', '13:00', '16:00'],
    durationMinutes: 60,
    capacity: 1,
    room: 'Кабинет А',
    timezoneOffsetMinutes: MOSCOW_TIME_OFFSET_MINUTES,
    validFrom: '2024-01-01T00:00:00+03:00'
  },
  {
    id: 'rule-ilya-msk-diagnostics',
    centerId: 'center-msk',
    specialistId: 'specialist-ilya',
    serviceId: 'diagnostics',
    daysOfWeek: [2, 4],
    startTimes: ['10:00', '14:30'],
    durationMinutes: 45,
    capacity: 1,
    room: 'Диагностическая комната',
    timezoneOffsetMinutes: MOSCOW_TIME_OFFSET_MINUTES,
    notes: 'Первичный анализ состояния и подбор программы',
    validFrom: '2024-01-01T00:00:00+03:00'
  },
  {
    id: 'rule-ilya-spb-weekend',
    centerId: 'center-spb',
    specialistId: 'specialist-ilya',
    serviceId: 'restoration-basic',
    daysOfWeek: [6],
    startTimes: ['11:00', '13:30'],
    durationMinutes: 60,
    capacity: 1,
    room: 'Кабинет 3',
    timezoneOffsetMinutes: MOSCOW_TIME_OFFSET_MINUTES,
    notes: 'Выездной приём для Санкт-Петербурга',
    validFrom: '2024-01-01T00:00:00+03:00'
  }
]

type NextLocalDateInput = {
  dayOfWeek: number
  time: string
  offsetMinutes: number
  lookAheadDays?: number
}

type NormalizedRule = ScheduleRule & {
  validFromMs?: number
  validUntilMs?: number
  timezoneOffsetMinutes: number
}

type NormalizedException = ScheduleException & {
  startMs: number
  endMs: number
}

function parseDateOption(value?: Date | string): Date | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

function startOfLocalDay(date: Date, offsetMinutes: number): Date {
  const shifted = new Date(date.getTime() + offsetMinutes * MS_PER_MINUTE)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - offsetMinutes * MS_PER_MINUTE)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE)
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  const hours = Number.parseInt(match[1] ?? '0', 10)
  const minutes = Number.parseInt(match[2] ?? '0', 10)
  return hours * 60 + minutes
}

function getLocalDayOfWeek(dayStartUtc: Date, offsetMinutes: number): number {
  const shifted = new Date(dayStartUtc.getTime() + offsetMinutes * MS_PER_MINUTE)
  return shifted.getUTCDay()
}

function nextLocalDate({ dayOfWeek, time, offsetMinutes, lookAheadDays = 14 }: NextLocalDateInput): Date {
  const now = new Date()
  const baseDay = startOfLocalDay(now, offsetMinutes)
  const minutes = parseTimeToMinutes(time) ?? 0

  for (let i = 0; i < lookAheadDays; i += 1) {
    const candidateDay = addDays(baseDay, i)
    if (getLocalDayOfWeek(candidateDay, offsetMinutes) !== dayOfWeek) {
      continue
    }
    const candidate = addMinutes(candidateDay, minutes)
    if (candidate.getTime() > now.getTime()) {
      return candidate
    }
  }

  const fallback = addDays(baseDay, lookAheadDays)
  return addMinutes(fallback, minutes)
}

function normalizeRules(rules: ScheduleRule[]): NormalizedRule[] {
  return rules.map((rule) => {
    const validFromMs = rule.validFrom ? Date.parse(rule.validFrom) : undefined
    const validUntilMs = rule.validUntil ? Date.parse(rule.validUntil) : undefined

    return {
      ...rule,
      validFromMs: Number.isFinite(validFromMs) ? validFromMs : undefined,
      validUntilMs: Number.isFinite(validUntilMs) ? validUntilMs : undefined,
      timezoneOffsetMinutes: rule.timezoneOffsetMinutes ?? MOSCOW_TIME_OFFSET_MINUTES
    }
  })
}

function normalizeExceptions(exceptions: ScheduleException[]): NormalizedException[] {
  return exceptions
    .map<NormalizedException | null>((exception) => {
      const startMs = Date.parse(exception.startsAt)
      const endMs = Date.parse(exception.endsAt)
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null
      }
      return {
        ...exception,
        startMs,
        endMs
      }
    })
    .filter((exception): exception is NormalizedException => Boolean(exception))
}

function buildRollingExceptions(): ScheduleException[] {
  const mariaTrainingStart = nextLocalDate({
    dayOfWeek: 3,
    time: '12:00',
    offsetMinutes: MOSCOW_TIME_OFFSET_MINUTES
  })

  const ilyaWorkshopStart = nextLocalDate({
    dayOfWeek: 4,
    time: '13:00',
    offsetMinutes: MOSCOW_TIME_OFFSET_MINUTES
  })

  return [
    {
      id: 'exception-maria-training',
      specialistId: 'specialist-maria',
      centerId: 'center-spb',
      serviceId: 'restoration-basic',
      startsAt: mariaTrainingStart.toISOString(),
      endsAt: addMinutes(mariaTrainingStart, 60).toISOString(),
      reason: 'Обучение команды DEVATA'
    },
    {
      id: 'exception-ilya-workshop',
      specialistId: 'specialist-ilya',
      centerId: 'center-msk',
      startsAt: ilyaWorkshopStart.toISOString(),
      endsAt: addMinutes(ilyaWorkshopStart, 120).toISOString(),
      reason: 'Участие в мастер-классе'
    }
  ]
}

export const demoScheduleExceptions: ScheduleException[] = buildRollingExceptions()

type SlotGenerationOptions = {
  centerId?: string
  serviceId?: string
  specialistId?: string
  from?: Date | string
  to?: Date | string
  limit?: number
}

function ensureSeedReservation(slots: Slot[]) {
  if (seededReservation || !slots.length) return
  const prioritized = slots.find((slot) => slot.serviceId === 'restoration-basic') ?? slots[0]
  if (prioritized) {
    const state = getReservationState(prioritized.id)
    state.confirmed = Math.max(state.confirmed, prioritized.capacity)
    state.holds = []
    seededReservation = true
  }
}

function applyReservations(slots: Slot[]): Slot[] {
  pruneExpiredReservations()
  ensureSeedReservation(slots)
  return slots.map((slot) => {
    const state = slotReservations.get(slot.id)
    if (!state) {
      return slot
    }
    const reserved = Math.min(slot.capacity, state.confirmed + state.holds.length)
    return {
      ...slot,
      remaining: Math.max(0, slot.capacity - reserved)
    }
  })
}

export function getDemoSlots(options: SlotGenerationOptions = {}): Slot[] {
  const { centerId, serviceId, specialistId } = options
  const fromDate = parseDateOption(options.from)
  const toDate = parseDateOption(options.to)
  const now = new Date()
  const windowStart = fromDate ?? now
  const windowEnd = toDate ?? addMinutes(windowStart, DEFAULT_WINDOW_DAYS * 24 * 60)

  if (windowEnd.getTime() < windowStart.getTime()) {
    return []
  }

  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const windowStartMs = windowStart.getTime()
  const windowEndMs = windowEnd.getTime()

  const normalizedRules = normalizeRules(demoScheduleRules).filter((rule) => {
    if (centerId && rule.centerId !== centerId) return false
    if (serviceId && rule.serviceId !== serviceId) return false
    if (specialistId && rule.specialistId !== specialistId) return false
    if (rule.validUntilMs != null && rule.validUntilMs < windowStartMs) return false
    if (rule.validFromMs != null && rule.validFromMs > windowEndMs) return false
    return true
  })

  if (!normalizedRules.length) {
    return []
  }

  const normalizedExceptions = normalizeExceptions(demoScheduleExceptions).filter((exception) => {
    if (specialistId && exception.specialistId !== specialistId) return false
    if (centerId && exception.centerId && exception.centerId !== centerId) return false
    if (serviceId && exception.serviceId && exception.serviceId !== serviceId) return false
    if (exception.endMs < windowStartMs) return false
    if (exception.startMs > windowEndMs) return false
    return true
  })

  const exceptionsByRule = new Map<string, NormalizedException[]>()
  for (const rule of normalizedRules) {
    const matches = normalizedExceptions.filter((exception) => {
      if (exception.specialistId !== rule.specialistId) return false
      if (exception.centerId && exception.centerId !== rule.centerId) return false
      if (exception.serviceId && exception.serviceId !== rule.serviceId) return false
      return true
    })
    exceptionsByRule.set(rule.id, matches)
  }

  const rulesByOffset = new Map<number, NormalizedRule[]>()
  for (const rule of normalizedRules) {
    const list = rulesByOffset.get(rule.timezoneOffsetMinutes) ?? []
    list.push(rule)
    rulesByOffset.set(rule.timezoneOffsetMinutes, list)
  }

  const offsets = Array.from(rulesByOffset.keys()).sort((a, b) => a - b)
  const slots: Slot[] = []

  outer: for (const offset of offsets) {
    const rulesForOffset = rulesByOffset.get(offset)
    if (!rulesForOffset?.length) continue

    const dayStart = startOfLocalDay(windowStart, offset)
    const dayEnd = startOfLocalDay(windowEnd, offset)

    for (let cursor = dayStart; cursor.getTime() <= dayEnd.getTime(); cursor = addDays(cursor, 1)) {
      const dayOfWeek = getLocalDayOfWeek(cursor, offset)

      for (const rule of rulesForOffset) {
        if (!rule.daysOfWeek.includes(dayOfWeek)) continue

        const ruleExceptions = exceptionsByRule.get(rule.id) ?? []

        for (const startTime of rule.startTimes) {
          const minutes = parseTimeToMinutes(startTime)
          if (minutes == null) continue

          const slotStart = new Date(cursor.getTime() + minutes * MS_PER_MINUTE)
          const startMs = slotStart.getTime()
          if (startMs < windowStartMs || startMs > windowEndMs) continue
          if (rule.validFromMs != null && startMs < rule.validFromMs) continue
          if (rule.validUntilMs != null && startMs > rule.validUntilMs) continue

          const endMs = startMs + rule.durationMinutes * MS_PER_MINUTE
          if (ruleExceptions.some((exception) => startMs < exception.endMs && endMs > exception.startMs)) {
            continue
          }

          slots.push({
            id: `slot-${rule.id}-${slotStart.toISOString()}`,
            centerId: rule.centerId,
            serviceId: rule.serviceId,
            specialistId: rule.specialistId,
            start: slotStart.toISOString(),
            end: new Date(endMs).toISOString(),
            capacity: rule.capacity ?? 1,
            remaining: rule.capacity ?? 1,
            room: rule.room,
            notes: rule.notes
          })

          if (slots.length >= limit) {
            break outer
          }
        }
      }
    }
  }

  slots.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  return applyReservations(slots)
}

export type { DemoBookingErrorCode }

export class DemoBookingError extends Error {
  code: DemoBookingErrorCode
  status: number

  constructor(code: DemoBookingErrorCode, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export class BookingNotFoundError extends Error {
  bookingId: string

  constructor(bookingId: string) {
    super(`Бронь ${bookingId} не найдена`)
    this.bookingId = bookingId
    this.name = 'BookingNotFoundError'
  }
}

export class BookingStatusTransitionError extends Error {
  from: BookingStatus
  to: BookingStatus

  constructor(from: BookingStatus, to: BookingStatus) {
    super(`Статус ${from} нельзя перевести в ${to}`)
    this.from = from
    this.to = to
    this.name = 'BookingStatusTransitionError'
  }
}

function nextDemoBookingId() {
  return `demo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export function queryDemoBookings(filters: BookingListFilters = {}): BookingRecord[] {
  ensureDemoBookingsSeeded()
  pruneExpiredReservations()
  const filtered = demoBookings.filter((booking) => matchesBookingFilters(booking, filters))
  filtered.sort((a, b) => (a.slotStart < b.slotStart ? -1 : a.slotStart > b.slotStart ? 1 : 0))
  return filtered.map((booking) => cloneBooking(booking))
}

export function listDemoBookings(): BookingRecord[] {
  return queryDemoBookings()
}

export function listDemoPartners(): Partner[] {
  return demoPartners.map((partner) => ({ ...partner }))
}

export function getDemoPartnerPayoutSnapshot(): PartnerPayoutSnapshot {
  const bookings = listDemoBookings()
  return buildPartnerPayoutSnapshot({
    bookings,
    partners: demoPartners,
    threshold: 50_000
  })
}

export function createDemoBooking(request: BookingRequest): BookingRecord {
  ensureDemoBookingsSeeded()
  pruneExpiredReservations()

  const slots = getDemoSlots({
    centerId: request.centerId,
    serviceId: request.serviceId,
    specialistId: request.specialistId
  })
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

  const service = demoServices.find((item) => item.id === request.serviceId)
  const payment = calculatePaymentSummary(service)
  const now = Date.now()
  const requiresUpfrontConfirmation =
    payment != null &&
    (payment.policy === 'full_prepaid' ||
      (payment.policy === 'deposit_required' && (payment.dueNowAmount ?? 0) > 0))

  const referralPath = resolveReferralPath(request)
  const specialistSharePercent = service?.specialistSharePercent
  const professionalMentorId = specialistMentorBySpecialist[request.specialistId]
  const funds = payment
    ? buildFundsLedger({
        payment,
        referralPath,
        specialistSharePercent,
        professionalMentorId,
        totalAmountFallback: service?.price
      })
    : undefined

  const stored = createStoredBooking({
    bookingId: nextDemoBookingId(),
    status: requiresUpfrontConfirmation ? 'reserved' : 'confirmed',
    slotStart: slot.start,
    slotEnd: slot.end,
    centerId: request.centerId,
    serviceId: request.serviceId,
    specialistId: request.specialistId,
    slotId: request.slotId,
    client: request.client,
    createdAt: new Date().toISOString(),
    payment,
    funds
  })

  demoBookings.push(stored)
  applyReservationTransition(stored, 'simulated', stored.status)

  return cloneBooking(stored)
}

export function createDemoFollowUpBooking(
  bookingId: string,
  followUp: BookingFollowUpRequest
): BookingRecord {
  ensureDemoBookingsSeeded()
  pruneExpiredReservations()

  const original = findStoredBooking(bookingId)
  if (!original) {
    throw new BookingNotFoundError(bookingId)
  }

  const followUpBooking = createDemoBooking({
    centerId: original.centerId,
    serviceId: original.serviceId,
    specialistId: original.specialistId,
    slotId: followUp.slotId,
    client: original.client,
    metadata: { followUpFor: bookingId }
  })

  const storedFollowUp = findStoredBooking(followUpBooking.bookingId)
  const followUpNoteParts = [`Follow-up для ${bookingId}`]
  const trimmedNote = followUp.note?.trim()
  if (trimmedNote) {
    followUpNoteParts.push(trimmedNote)
  }
  if (storedFollowUp?.statusHistory?.length) {
    storedFollowUp.statusHistory[storedFollowUp.statusHistory.length - 1].note =
      followUpNoteParts.join(' · ')
  }

  const originalNoteParts = [
    `Назначен follow-up: бронь ${followUpBooking.bookingId}`,
    `слот ${followUpBooking.slotStart}`
  ]
  if (trimmedNote) {
    originalNoteParts.push(trimmedNote)
  }

  recordStatusChange(original, original.status, {
    note: originalNoteParts.join(' · ')
  })

  return storedFollowUp ? cloneBooking(storedFollowUp) : followUpBooking
}

export function getDemoBookingById(bookingId: string): BookingRecord | undefined {
  ensureDemoBookingsSeeded()
  pruneExpiredReservations()
  const booking = demoBookings.find((item) => item.bookingId === bookingId)
  return booking ? cloneBooking(booking) : undefined
}

export function updateDemoBookingStatus(
  bookingId: string,
  status: BookingStatus,
  options: { note?: string } = {}
): BookingRecord {
  ensureDemoBookingsSeeded()
  pruneExpiredReservations()

  const booking = demoBookings.find((item) => item.bookingId === bookingId)
  if (!booking) {
    throw new BookingNotFoundError(bookingId)
  }

  const previousStatus = booking.status
  const changedAt = new Date().toISOString()

  if (previousStatus === status) {
    if (options.note) {
      recordStatusChange(booking, status, {
        previousStatus,
        changedAt,
        note: options.note
      })
    }
    return cloneBooking(booking)
  }

  const allowed = ALLOWED_STATUS_TRANSITIONS[previousStatus] ?? []
  if (!allowed.includes(status)) {
    throw new BookingStatusTransitionError(previousStatus, status)
  }

  applyReservationTransition(booking, previousStatus, status)
  recordStatusChange(booking, status, {
    previousStatus,
    changedAt,
    note: options.note
  })

  if (booking.payment && previousStatus === 'reserved' && status === 'confirmed') {
    booking.payment.depositDueAt = undefined
    booking.payment.depositHoldMinutes = undefined
  }

  return cloneBooking(booking)
}

export type { SlotGenerationOptions }
