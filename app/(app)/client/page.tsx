import { BookingStatusBadge } from '@/components/BookingStatusBadge'
import {
  getCenters,
  getServices,
  getSpecialists,
  listBookings,
  type BookingRecord
} from '@/lib/booking'
import { formatCurrency, formatDateTime, formatSlotRange } from '@/lib/formatters'

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
          <BookingStatusBadge status={booking.status} />
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
