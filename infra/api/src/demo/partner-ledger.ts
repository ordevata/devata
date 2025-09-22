import type {
  BookingRecord,
  Partner,
  PartnerLedgerEntry,
  PartnerLedgerEntryStatus,
  PartnerPayoutSnapshot,
  PartnerPayoutSummary,
  PartnerPayoutTotals,
  PaymentComponentKind
} from './booking-types.js'

const DEFAULT_THRESHOLD = 50_000

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function resolveOccurredAt(booking: BookingRecord, fallback: string | undefined): string {
  if (booking.createdAt) return booking.createdAt
  if (fallback) return fallback
  return booking.slotStart
}

function determineEntryStatus(
  booking: BookingRecord,
  componentKind: PaymentComponentKind,
  nowMs: number
): PartnerLedgerEntryStatus {
  if (booking.status === 'expired') {
    return 'pending'
  }

  if (booking.status !== 'confirmed') {
    return 'pending'
  }

  if (componentKind === 'balance' || componentKind === 'pay_on_visit') {
    const slotStartMs = Date.parse(booking.slotStart)
    if (Number.isFinite(slotStartMs) && slotStartMs <= nowMs) {
      return 'approved'
    }
    return 'pending'
  }

  return 'approved'
}

type BuildPartnerLedgerOptions = {
  bookings: BookingRecord[]
  partners: Partner[]
  now?: Date
}

export function buildPartnerLedgerEntries({
  bookings,
  partners,
  now
}: BuildPartnerLedgerOptions): PartnerLedgerEntry[] {
  const nowMs = now ? now.getTime() : Date.now()
  const partnerIndex = new Map(partners.map((partner) => [partner.id, partner]))
  const entries: PartnerLedgerEntry[] = []

  for (const booking of bookings) {
    const funds = booking.funds
    if (!funds || !funds.components.length) continue
    if (booking.status === 'expired') continue

    for (const component of funds.components) {
      const status = determineEntryStatus(booking, component.kind, nowMs)
      const occurredAt = resolveOccurredAt(booking, component.dueAt)

      for (const allocation of component.fund26.allocations) {
        const amount = roundCurrency(allocation.amount)
        if (amount <= 0) continue

        const partner = partnerIndex.get(allocation.partnerId)
        entries.push({
          partnerId: allocation.partnerId,
          partnerName: partner?.fullName ?? allocation.partnerId,
          amount,
          percent: allocation.percent,
          level: allocation.level,
          type: 'referral',
          componentKind: component.kind,
          bookingId: booking.bookingId,
          occurredAt,
          status,
          description:
            component.kind === 'deposit'
              ? `Начисление по депозиту (уровень ${allocation.level})`
              : `Начисление по оплате (уровень ${allocation.level})`
        })
      }

      const professionalBonus = component.fund26.professionalBonus
      if (professionalBonus) {
        const amount = roundCurrency(professionalBonus.amount)
        if (amount > 0) {
          const partner = partnerIndex.get(professionalBonus.partnerId)
          entries.push({
            partnerId: professionalBonus.partnerId,
            partnerName: partner?.fullName ?? professionalBonus.partnerId,
            amount,
            percent: professionalBonus.percent,
            type: 'professional_bonus',
            componentKind: component.kind,
            bookingId: booking.bookingId,
            occurredAt,
            status,
            description: `Профессиональный бонус ${professionalBonus.percent}% от дохода специалиста`
          })
        }
      }
    }
  }

  entries.sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : a.occurredAt < b.occurredAt ? 1 : 0))

  return entries
}

type BuildPartnerPayoutSnapshotOptions = BuildPartnerLedgerOptions & {
  threshold?: number
}

export function buildPartnerPayoutSnapshot({
  bookings,
  partners,
  now,
  threshold
}: BuildPartnerPayoutSnapshotOptions): PartnerPayoutSnapshot {
  const generatedAt = (now ?? new Date()).toISOString()
  const effectiveThreshold = roundCurrency(threshold ?? DEFAULT_THRESHOLD)
  const partnerIndex = new Map(partners.map((partner) => [partner.id, partner]))
  const entries = buildPartnerLedgerEntries({ bookings, partners, now })

  const summaries = new Map<string, PartnerPayoutSummary>()

  function ensureSummary(partnerId: string): PartnerPayoutSummary {
    let summary = summaries.get(partnerId)
    if (summary) return summary
    const partner = partnerIndex.get(partnerId) ?? {
      id: partnerId,
      fullName: partnerId
    }
    summary = {
      partner,
      threshold: effectiveThreshold,
      pendingAmount: 0,
      approvedAmount: 0,
      paidAmount: 0,
      totalBalance: 0,
      cashoutAvailable: 0,
      carryOverAmount: 0,
      availableForServices: 0,
      eligibleForPayout: false,
      progressToThreshold: 0,
      ledger: [],
      updatedAt: generatedAt
    }
    summaries.set(partnerId, summary)
    return summary
  }

  for (const partner of partners) {
    ensureSummary(partner.id)
  }

  for (const entry of entries) {
    const summary = ensureSummary(entry.partnerId)
    summary.ledger.push(entry)
    switch (entry.status) {
      case 'approved':
        summary.approvedAmount = roundCurrency(summary.approvedAmount + entry.amount)
        break
      case 'paid':
        summary.paidAmount = roundCurrency(summary.paidAmount + entry.amount)
        break
      default:
        summary.pendingAmount = roundCurrency(summary.pendingAmount + entry.amount)
        break
    }
  }

  const orderedSummaries: PartnerPayoutSummary[] = []
  let totalPending = 0
  let totalApproved = 0
  let totalPaid = 0
  let totalCashout = 0
  let eligibleCount = 0

  for (const summary of summaries.values()) {
    summary.ledger.sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : a.occurredAt < b.occurredAt ? 1 : 0))
    summary.totalBalance = roundCurrency(summary.pendingAmount + summary.approvedAmount)
    summary.availableForServices = summary.totalBalance
    summary.cashoutAvailable = summary.approvedAmount >= effectiveThreshold ? summary.approvedAmount : 0
    summary.carryOverAmount = roundCurrency(summary.totalBalance - summary.cashoutAvailable)
    summary.eligibleForPayout = summary.cashoutAvailable > 0
    summary.progressToThreshold = effectiveThreshold
      ? Math.min(100, roundCurrency((summary.approvedAmount / effectiveThreshold) * 100))
      : 100

    totalPending = roundCurrency(totalPending + summary.pendingAmount)
    totalApproved = roundCurrency(totalApproved + summary.approvedAmount)
    totalPaid = roundCurrency(totalPaid + summary.paidAmount)
    totalCashout = roundCurrency(totalCashout + summary.cashoutAvailable)

    if (summary.eligibleForPayout) {
      eligibleCount += 1
    }

    orderedSummaries.push(summary)
  }

  orderedSummaries.sort((a, b) => (a.totalBalance > b.totalBalance ? -1 : a.totalBalance < b.totalBalance ? 1 : 0))

  const totals: PartnerPayoutTotals = {
    pendingAmount: totalPending,
    approvedAmount: totalApproved,
    paidAmount: totalPaid,
    cashoutAvailable: totalCashout,
    partnersEligible: eligibleCount
  }

  return {
    threshold: effectiveThreshold,
    generatedAt,
    totals,
    summaries: orderedSummaries
  }
}
