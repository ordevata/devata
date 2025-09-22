import type {
  BookingFundsLedger,
  BookingPaymentSummary,
  Fund26Portion,
  Fund74Allocation,
  Fund74Portion,
  PaymentComponentKind,
  PaymentComponentLedger,
  ReferralAllocation
} from './booking-types'

const FUND_26_PERCENT = 26
const PROFESSIONAL_BONUS_PERCENT = 2
const REFERRAL_LEVELS: Array<{ level: 1 | 2 | 3 | 4 | 5; percent: number }> = [
  { level: 1, percent: 10 },
  { level: 2, percent: 3 },
  { level: 3, percent: 3 },
  { level: 4, percent: 1 },
  { level: 5, percent: 1 }
]

type DerivedComponent = {
  kind: PaymentComponentKind
  amount: number
  dueAt?: string
}

type BuildFundsLedgerOptions = {
  payment?: BookingPaymentSummary
  currency?: string
  referralPath?: string[]
  specialistSharePercent?: number
  professionalMentorId?: string
  totalAmountFallback?: number
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function deriveComponents(summary?: BookingPaymentSummary): DerivedComponent[] {
  if (!summary) return []

  const components: DerivedComponent[] = []
  const total = roundCurrency(summary.totalAmount ?? 0)
  const dueNow = roundCurrency(summary.dueNowAmount ?? 0)
  const dueLater = roundCurrency(summary.dueLaterAmount ?? 0)

  switch (summary.policy) {
    case 'full_prepaid': {
      const amount = dueNow > 0 ? dueNow : total
      if (amount > 0) {
        components.push({ kind: 'full', amount, dueAt: summary.depositDueAt })
      }
      break
    }
    case 'deposit_required':
    case 'deposit_optional': {
      if (dueNow > 0) {
        components.push({ kind: 'deposit', amount: dueNow, dueAt: summary.depositDueAt })
      }
      if (dueLater > 0) {
        components.push({ kind: 'balance', amount: dueLater })
      }
      break
    }
    default: {
      const amount = dueLater > 0 ? dueLater : total > 0 ? total : dueNow
      if (amount > 0) {
        components.push({ kind: 'pay_on_visit', amount })
      }
    }
  }

  return components
}

export function buildFundsLedger({
  payment,
  currency,
  referralPath,
  specialistSharePercent,
  professionalMentorId,
  totalAmountFallback
}: BuildFundsLedgerOptions): BookingFundsLedger | undefined {
  const sanitizedPath = (referralPath ?? []).filter((id) => Boolean(id)).slice(0, 5)
  let components = deriveComponents(payment)

  const fallbackTotal = roundCurrency(payment?.totalAmount ?? totalAmountFallback ?? 0)
  if (!components.length && fallbackTotal > 0) {
    components = [
      {
        kind: payment?.policy === 'full_prepaid' ? 'full' : 'pay_on_visit',
        amount: fallbackTotal
      }
    ]
  }

  if (!components.length) return undefined

  const ledger: BookingFundsLedger = {
    currency: payment?.currency ?? currency ?? 'RUB',
    totalAmount: payment?.totalAmount ?? fallbackTotal,
    components: [],
    referralPath: sanitizedPath.length ? sanitizedPath : undefined
  }

  for (const component of components) {
    const amount = roundCurrency(component.amount)
    if (amount <= 0) continue

    const fund26Total = roundCurrency((amount * FUND_26_PERCENT) / 100)
    let remaining26 = fund26Total
    const allocations: ReferralAllocation[] = []

    sanitizedPath.forEach((partnerId, index) => {
      const levelDef = REFERRAL_LEVELS[index]
      if (!levelDef || remaining26 <= 0) return
      const desired = roundCurrency((amount * levelDef.percent) / 100)
      if (desired <= 0) return
      const allocationAmount = Math.min(desired, remaining26)
      if (allocationAmount <= 0) return
      allocations.push({
        level: levelDef.level,
        percent: levelDef.percent,
        amount: allocationAmount,
        partnerId
      })
      remaining26 = roundCurrency(remaining26 - allocationAmount)
    })

    let professionalBonus: Fund26Portion['professionalBonus']
    if (
      professionalMentorId &&
      specialistSharePercent &&
      specialistSharePercent > 0 &&
      remaining26 > 0
    ) {
      const specialistIncome = roundCurrency((amount * specialistSharePercent) / 100)
      if (specialistIncome > 0) {
        const desiredBonus = roundCurrency((specialistIncome * PROFESSIONAL_BONUS_PERCENT) / 100)
        if (desiredBonus > 0) {
          const bonusAmount = Math.min(desiredBonus, remaining26)
          if (bonusAmount > 0) {
            professionalBonus = {
              partnerId: professionalMentorId,
              percent: PROFESSIONAL_BONUS_PERCENT,
              amount: bonusAmount,
              specialistSharePercent,
              basisAmount: specialistIncome
            }
            remaining26 = roundCurrency(remaining26 - bonusAmount)
          }
        }
      }
    }

    const fund26Portion: Fund26Portion = {
      total: fund26Total,
      allocations,
      professionalBonus,
      reserve: roundCurrency(Math.max(0, remaining26))
    }

    const fund74Total = roundCurrency(amount - fund26Total)
    let remaining74 = fund74Total
    const fund74Allocations: Fund74Allocation[] = []

    if (specialistSharePercent && specialistSharePercent > 0 && remaining74 > 0) {
      const desiredShare = roundCurrency((amount * specialistSharePercent) / 100)
      if (desiredShare > 0) {
        const shareAmount = Math.min(desiredShare, remaining74)
        if (shareAmount > 0) {
          fund74Allocations.push({
            category: 'specialist',
            percent: specialistSharePercent,
            amount: shareAmount,
            description: 'Доля специалиста из операционного фонда'
          })
          remaining74 = roundCurrency(remaining74 - shareAmount)
        }
      }
    }

    const fund74Portion: Fund74Portion = {
      total: fund74Total,
      allocations: fund74Allocations,
      remaining: roundCurrency(Math.max(0, remaining74))
    }

    const ledgerComponent: PaymentComponentLedger = {
      kind: component.kind,
      amount,
      dueAt: component.dueAt,
      fund26: fund26Portion,
      fund74: fund74Portion
    }

    ledger.components.push(ledgerComponent)
  }

  if (!ledger.components.length) {
    return undefined
  }

  return ledger
}

