import {
  getCenters,
  getServices,
  getSpecialists,
  listBookings,
  type BookingRecord,
  type BookingStatus
} from '@/lib/booking'

const STATUS_META: Record<BookingStatus, { label: string; className: string }> = {
  reserved: {
    label: 'Ожидает депозита',
    className: 'bg-amber-100 text-amber-800 border border-amber-200'
  },
  confirmed: {
    label: 'Подтверждено',
    className: 'bg-emerald-100 text-emerald-800 border border-emerald-200'
  },
  checked_in: {
    label: 'Клиент на месте',
    className: 'bg-sky-100 text-sky-800 border border-sky-200'
  },
  completed: {
    label: 'Завершено',
    className: 'bg-emerald-200 text-emerald-900 border border-emerald-300'
  },
  expired: {
    label: 'Истекло',
    className: 'bg-rose-100 text-rose-800 border border-rose-200'
  },
  canceled: {
    label: 'Отменено',
    className: 'bg-slate-200 text-slate-700 border border-slate-300'
  },
  no_show: {
    label: 'Неявка',
    className: 'bg-rose-200 text-rose-900 border border-rose-300'
  },
  simulated: {
    label: 'Черновик',
    className: 'bg-slate-200 text-slate-700 border border-slate-300'
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short'
})
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' })
const timeFormatter = new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' })
const currencyFormatters = new Map<string, Intl.NumberFormat>()

function parseDate(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatCurrency(amount?: number, currency = 'RUB'): string | null {
  if (amount == null) return null
  let formatter = currencyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    })
    currencyFormatters.set(currency, formatter)
  }
  return formatter.format(amount)
}

function formatSlotRange(startIso: string, endIso: string): string {
  const start = parseDate(startIso)
  const end = parseDate(endIso)
  if (!start || !end) return 'Дата не указана'
  const sameDay = start.toDateString() === end.toDateString()
  if (sameDay) {
    return `${dateFormatter.format(start)}, ${timeFormatter.format(start)}–${timeFormatter.format(end)}`
  }
  return `${dateTimeFormatter.format(start)} — ${dateTimeFormatter.format(end)}`
}

function formatDateTime(value?: string): string | null {
  const parsed = parseDate(value)
  return parsed ? dateTimeFormatter.format(parsed) : null
}

function renderPaymentDetails(booking: BookingRecord) {
  const payment = booking.payment
  if (!payment) return null

  const currency = payment.currency ?? 'RUB'
  const total = formatCurrency(payment.totalAmount, currency)
  const dueNow = formatCurrency(payment.dueNowAmount, currency)
  const dueLater = formatCurrency(payment.dueLaterAmount, currency)

  const notes: string[] = []
  if (dueNow) {
    notes.push(payment.policy === 'deposit_required' ? `Депозит: ${dueNow}` : `К оплате сейчас: ${dueNow}`)
  }
  if (dueLater) {
    notes.push(`Остаток к визиту: ${dueLater}`)
  }
  if (!notes.length && total) {
    notes.push(`Стоимость визита: ${total}`)
  }

  const depositDeadline =
    booking.status === 'reserved' && payment.depositDueAt
      ? formatDateTime(payment.depositDueAt)
      : null

  return (
    <div className="space-y-1 text-sm text-slate-600">
      <p>{notes.join(' · ')}</p>
      {depositDeadline ? (
        <p className="text-xs text-amber-600">Внесите депозит до {depositDeadline}</p>
      ) : null}
      {payment.note ? <p className="text-xs text-slate-500">{payment.note}</p> : null}
    </div>
  )
}

function renderStatus(status: BookingStatus) {
  const meta = STATUS_META[status] ?? {
    label: status,
    className: 'bg-slate-100 text-slate-700 border border-slate-200'
  }
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  )
}

export default async function Page() {
  const [{ bookings }, centers, services, specialists] = await Promise.all([
    listBookings(),
    getCenters(),
    getServices(),
    getSpecialists()
  ])

  const centerMap = new Map(centers.map((center) => [center.id, center]))
  const serviceMap = new Map(services.map((service) => [service.id, service]))
  const specialistMap = new Map(specialists.map((specialist) => [specialist.id, specialist]))

  const now = Date.now()
  const awaitingPayment = bookings
    .filter((booking) => booking.status === 'reserved')
    .sort((a, b) => Date.parse(a.payment?.depositDueAt ?? a.slotStart) - Date.parse(b.payment?.depositDueAt ?? b.slotStart))
  const upcoming = bookings
    .filter((booking) =>
      ['confirmed', 'checked_in', 'simulated'].includes(booking.status) && Date.parse(booking.slotEnd) >= now
    )
    .sort((a, b) => Date.parse(a.slotStart) - Date.parse(b.slotStart))
  const expired = bookings
    .filter((booking) => booking.status === 'expired')
    .sort((a, b) => Date.parse(a.slotStart) - Date.parse(b.slotStart))
  const history = bookings
    .filter((booking) => {
      if (booking.status === 'expired') return false
      if (['completed', 'canceled', 'no_show'].includes(booking.status)) return true
      return Date.parse(booking.slotEnd) < now
    })
    .sort((a, b) => Date.parse(b.slotStart) - Date.parse(a.slotStart))
    .slice(0, 5)

  const renderBooking = (booking: BookingRecord) => {
    const center = centerMap.get(booking.centerId)
    const service = serviceMap.get(booking.serviceId)
    const specialist = specialistMap.get(booking.specialistId)
    const createdAt = formatDateTime(booking.createdAt)
    const updatedAt =
      booking.updatedAt && booking.updatedAt !== booking.createdAt
        ? formatDateTime(booking.updatedAt)
        : null
    const latestNote = booking.statusHistory
      ?.slice()
      .reverse()
      .find((entry) => entry.note && entry.status === booking.status)?.note

    return (
      <li key={booking.bookingId} className="rounded-xl border p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-lg font-semibold text-slate-900">{service?.name ?? 'Услуга не найдена'}</p>
            <p className="text-sm text-slate-600">
              {center?.name ?? 'Центр не указан'} • {specialist?.fullName ?? 'Специалист не назначен'}
            </p>
          </div>
          {renderStatus(booking.status)}
        </div>
        <p className="mt-3 text-sm font-medium text-slate-700">{formatSlotRange(booking.slotStart, booking.slotEnd)}</p>
        <div className="mt-3 space-y-2">
          {renderPaymentDetails(booking)}
          {createdAt ? (
            <p className="text-xs text-slate-500">Бронь оформлена {createdAt}</p>
          ) : null}
          {updatedAt ? (
            <p className="text-xs text-slate-500">Статус обновлён {updatedAt}</p>
          ) : null}
          {latestNote ? (
            <p className="text-xs text-slate-600">Комментарий: {latestNote}</p>
          ) : null}
        </div>
      </li>
    )
  }

  const renderSection = (title: string, description: string, items: BookingRecord[], empty: string) => (
    <section className="card space-y-4">
      <header className="space-y-1">
        <h2 className="h2">{title}</h2>
        <p className="text-sm text-slate-600">{description}</p>
      </header>
      {items.length ? (
        <ul className="space-y-3">{items.map(renderBooking)}</ul>
      ) : (
        <p className="text-sm text-slate-500">{empty}</p>
      )}
    </section>
  )

  return (
    <div className="space-y-8">
      <section className="card space-y-4">
        <div className="space-y-2">
          <h1 className="h1">Мои записи</h1>
          <p className="text-sm text-slate-600">
            Здесь отображаются все текущие и прошедшие брони, статусы оплат и дедлайны по депозитам.
          </p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Всего броней</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">{bookings.length}</dd>
          </div>
          <div className="rounded-xl bg-amber-50 p-4">
            <dt className="text-xs uppercase tracking-wide text-amber-600">Требуют оплаты</dt>
            <dd className="mt-1 text-2xl font-semibold text-amber-700">{awaitingPayment.length}</dd>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4">
            <dt className="text-xs uppercase tracking-wide text-emerald-600">Ближайшие визиты</dt>
            <dd className="mt-1 text-2xl font-semibold text-emerald-700">{upcoming.length}</dd>
          </div>
          <div className="rounded-xl bg-rose-50 p-4">
            <dt className="text-xs uppercase tracking-wide text-rose-600">Просроченные</dt>
            <dd className="mt-1 text-2xl font-semibold text-rose-700">{expired.length}</dd>
          </div>
        </dl>
      </section>

      {renderSection(
        'Ожидают подтверждения',
        'Депозит ещё не внесён. Слот удерживается ограниченное время — успейте завершить оплату.',
        awaitingPayment,
        'Нет броней, ожидающих предоплату.'
      )}

      {renderSection(
        'Ближайшие визиты',
        'Подтверждённые записи и черновики, которые ещё предстоит пройти.',
        upcoming,
        'Пока нет запланированных визитов.'
      )}

      {renderSection(
        'Просроченные',
        'Слоты, по которым истёк дедлайн депозита. При необходимости повторите бронирование.',
        expired,
        'Нет просроченных броней — отлично!'
      )}

      {renderSection(
        'История',
        'Недавние завершённые визиты сохраняются для справки.',
        history,
        'История пока пуста.'
      )}
    </div>
  )
}
