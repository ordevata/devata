export type PaymentPolicy = 'deposit_required' | 'deposit_optional' | 'full_prepaid' | 'none'

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
  price?: number
  depositPercent?: number
  paymentPolicy?: PaymentPolicy
  depositDueMinutes?: number
  specialistSharePercent?: number
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

export type ScheduleRule = {
  id: string
  centerId: string
  specialistId: string
  serviceId: string
  /**
   * Дни недели в формате `0-6`, где 0 — воскресенье (совпадает с `Date.getUTCDay`).
   */
  daysOfWeek: number[]
  /**
   * Список стартовых времён в формате `HH:mm` в локальном часовом поясе правила.
   */
  startTimes: string[]
  durationMinutes: number
  capacity?: number
  room?: string
  notes?: string
  /**
   * Смещение часового пояса в минутах относительно UTC (по умолчанию `+180` для Москвы).
   */
  timezoneOffsetMinutes?: number
  /**
   * Слот действует начиная с указанной даты/времени (ISO8601).
   */
  validFrom?: string
  /**
   * Слот действует до указанной даты/времени (ISO8601).
   */
  validUntil?: string
}

export type ScheduleException = {
  id: string
  specialistId: string
  centerId?: string
  serviceId?: string
  startsAt: string
  endsAt: string
  reason?: string
}

export type BookingClient = {
  fullName: string
  phone: string
  email?: string
  comment?: string
  preferredChannel?: 'email' | 'telegram' | 'whatsapp'
}

export type BookingReferralContext = {
  refId?: string
  path?: string[]
  attributedAt?: string
}

export type BookingRequest = {
  centerId: string
  serviceId: string
  specialistId: string
  slotId: string
  client: BookingClient
  metadata?: Record<string, unknown>
  referral?: BookingReferralContext
}

export type BookingFollowUpRequest = {
  slotId: string
  note?: string
}

export type BookingStatus =
  | 'reserved'
  | 'expired'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'no_show'
  | 'canceled'
  | 'simulated'

export type BookingStatusChange = {
  status: BookingStatus
  changedAt: string
  previousStatus?: BookingStatus
  note?: string
}

export type BookingPaymentSummary = {
  policy: PaymentPolicy
  currency?: string
  totalAmount?: number
  dueNowAmount?: number
  dueLaterAmount?: number
  isDepositOptional?: boolean
  depositHoldMinutes?: number
  depositDueAt?: string
  note?: string
}

export type ReferralAllocation = {
  level: 1 | 2 | 3 | 4 | 5
  percent: number
  amount: number
  partnerId: string
}

export type ProfessionalBonusAllocation = {
  partnerId: string
  percent: number
  amount: number
  specialistSharePercent: number
  basisAmount: number
}

export type Fund26Portion = {
  total: number
  allocations: ReferralAllocation[]
  professionalBonus?: ProfessionalBonusAllocation
  reserve: number
}

export type Fund74Allocation = {
  category: 'specialist' | 'lecturer' | 'assistant' | 'operations'
  percent?: number
  amount: number
  description?: string
}

export type Fund74Portion = {
  total: number
  allocations: Fund74Allocation[]
  remaining: number
}

export type PaymentComponentKind = 'deposit' | 'balance' | 'full' | 'pay_on_visit'

export type PaymentComponentLedger = {
  kind: PaymentComponentKind
  amount: number
  dueAt?: string
  fund26: Fund26Portion
  fund74: Fund74Portion
}

export type BookingFundsLedger = {
  currency: string
  totalAmount?: number
  components: PaymentComponentLedger[]
  referralPath?: string[]
}

export type BookingResponse = {
  bookingId: string
  status: BookingStatus
  slotStart: string
  slotEnd: string
  payment?: BookingPaymentSummary
  funds?: BookingFundsLedger
  updatedAt?: string
  statusHistory?: BookingStatusChange[]
}

export type BookingRecord = BookingResponse & {
  centerId: string
  serviceId: string
  specialistId: string
  slotId: string
  client: BookingClient
  createdAt: string
}

export type BookingListFilters = {
  centerId?: string
  serviceId?: string
  specialistId?: string
  phone?: string
  email?: string
  status?: BookingStatus[]
}

export type BookingListResponse = {
  bookings: BookingRecord[]
  total: number
  generatedAt: string
}

export type Partner = {
  id: string
  fullName: string
  parentId?: string
  trained?: boolean
}

export type PartnerLedgerEntryType = 'referral' | 'professional_bonus'

export type PartnerLedgerEntryStatus = 'pending' | 'approved' | 'paid'

export type PartnerLedgerEntry = {
  partnerId: string
  partnerName: string
  amount: number
  percent: number
  level?: 1 | 2 | 3 | 4 | 5
  type: PartnerLedgerEntryType
  componentKind: PaymentComponentKind
  bookingId: string
  occurredAt: string
  status: PartnerLedgerEntryStatus
  description?: string
}

export type PartnerPayoutSummary = {
  partner: Partner
  threshold: number
  pendingAmount: number
  approvedAmount: number
  paidAmount: number
  totalBalance: number
  cashoutAvailable: number
  carryOverAmount: number
  availableForServices: number
  eligibleForPayout: boolean
  progressToThreshold: number
  ledger: PartnerLedgerEntry[]
  updatedAt: string
}

export type PartnerPayoutTotals = {
  pendingAmount: number
  approvedAmount: number
  paidAmount: number
  cashoutAvailable: number
  partnersEligible: number
}

export type PartnerPayoutSnapshot = {
  threshold: number
  generatedAt: string
  totals: PartnerPayoutTotals
  summaries: PartnerPayoutSummary[]
}
