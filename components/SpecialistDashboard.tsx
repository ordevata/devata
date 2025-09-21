'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { BookingStatusBadge, getStatusMeta } from '@/components/BookingStatusBadge'
import type {
  BookingListResponse,
  BookingRecord,
  BookingStatus,
  Specialist
} from '@/lib/booking-types'
import { formatCurrency, formatDateTime, formatSlotRange } from '@/lib/formatters'

const UPCOMING_STATUSES: BookingStatus[] = ['reserved', 'confirmed', 'checked_in']

type ActionVariant = 'primary' | 'secondary' | 'danger' | 'warning'

type StatusAction = {
  status: BookingStatus
  label: string
  variant?: ActionVariant
  confirmMessage?: string
}

const ACTIONS: Partial<Record<BookingStatus, StatusAction[]>> = {
  reserved: [
    { status: 'confirmed', label: 'Подтвердить депозит', variant: 'primary' },
    {
      status: 'canceled',
      label: 'Отменить бронь',
      variant: 'danger',
      confirmMessage: 'Отменить бронь? Клиент получит уведомление.'
    }
  ],
  confirmed: [
    { status: 'checked_in', label: 'Клиент пришёл', variant: 'primary' },
    { status: 'completed', label: 'Завершить визит', variant: 'secondary' },
    {
      status: 'no_show',
      label: 'Неявка',
      variant: 'warning',
      confirmMessage: 'Зафиксировать неявку клиента?' 
    },
    {
      status: 'canceled',
      label: 'Отменить бронь',
      variant: 'danger',
      confirmMessage: 'Отменить бронь после подтверждения?'
    }
  ],
  checked_in: [
    { status: 'completed', label: 'Завершить визит', variant: 'primary' }
  ],
  simulated: [
    { status: 'confirmed', label: 'Перевести в подтверждённую', variant: 'primary' },
    {
      status: 'canceled',
      label: 'Удалить бронь',
      variant: 'danger',
      confirmMessage: 'Удалить черновую бронь?'
    }
  ]
}

const VARIANT_STYLES: Record<ActionVariant, string> = {
  primary:
    'inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-wait disabled:bg-emerald-300',
  secondary:
    'inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:cursor-wait disabled:bg-rose-300',
  warning:
    'inline-flex items-center justify-center rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-wait disabled:bg-amber-300'
}

type SpecialistDashboardProps = {
  specialists: Specialist[]
  initialSpecialistId?: string
  initialData: BookingListResponse
}

export function SpecialistDashboard({
  specialists,
  initialSpecialistId,
  initialData
}: SpecialistDashboardProps) {
  const [selectedSpecialistId, setSelectedSpecialistId] = useState(
    initialSpecialistId ?? specialists[0]?.id ?? ''
  )
  const [bookings, setBookings] = useState<BookingRecord[]>(initialData.bookings)
  const [generatedAt, setGeneratedAt] = useState(initialData.generatedAt)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const initialIdRef = useRef(initialSpecialistId ?? '')
  const hasSkippedInitialRef = useRef(false)

  useEffect(() => {
    if (!selectedSpecialistId) {
      setBookings([])
      setGeneratedAt(new Date().toISOString())
      return
    }

    if (!hasSkippedInitialRef.current && selectedSpecialistId === initialIdRef.current) {
      hasSkippedInitialRef.current = true
      return
    }

    let aborted = false
    setLoading(true)
    setError(null)

    fetch(`/api/v1/booking?specialist_id=${encodeURIComponent(selectedSpecialistId)}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(payload?.error ?? 'Не удалось загрузить расписание')
        }
        return (await response.json()) as BookingListResponse
      })
      .then((data) => {
        if (aborted) return
        setBookings(data.bookings)
        setGeneratedAt(data.generatedAt)
        setFlashMessage('Расписание обновлено')
      })
      .catch((fetchError: unknown) => {
        if (aborted) return
        setError(fetchError instanceof Error ? fetchError.message : 'Не удалось загрузить расписание')
      })
      .finally(() => {
        if (aborted) return
        setLoading(false)
      })

    return () => {
      aborted = true
    }
  }, [selectedSpecialistId])

  const upcoming = useMemo(() => {
    const now = Date.now()
    return bookings
      .filter((booking) =>
        UPCOMING_STATUSES.includes(booking.status) && Date.parse(booking.slotEnd) >= now
      )
      .sort((a, b) => Date.parse(a.slotStart) - Date.parse(b.slotStart))
  }, [bookings])

  const awaitingDeposit = useMemo(
    () =>
      bookings
        .filter((booking) => booking.status === 'reserved')
        .sort((a, b) =>
          Date.parse(a.payment?.depositDueAt ?? a.slotStart) -
          Date.parse(b.payment?.depositDueAt ?? b.slotStart)
        ),
    [bookings]
  )

  const history = useMemo(() => {
    const now = Date.now()
    return bookings
      .filter((booking) => {
        if (booking.status === 'reserved') return false
        if (UPCOMING_STATUSES.includes(booking.status)) {
          return Date.parse(booking.slotEnd) < now
        }
        return true
      })
      .sort((a, b) => Date.parse(b.slotStart) - Date.parse(a.slotStart))
      .slice(0, 10)
  }, [bookings])

  async function refresh() {
    if (!selectedSpecialistId) return
    hasSkippedInitialRef.current = true
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/booking?specialist_id=${encodeURIComponent(selectedSpecialistId)}`
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload?.error ?? 'Не удалось обновить расписание')
      }
      const data = (await response.json()) as BookingListResponse
      setBookings(data.bookings)
      setGeneratedAt(data.generatedAt)
      setFlashMessage('Данные обновлены')
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : 'Не удалось обновить расписание'
      )
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(booking: BookingRecord, nextStatus: BookingStatus) {
    const actions = ACTIONS[booking.status] ?? []
    const action = actions.find((item) => item.status === nextStatus)
    if (action?.confirmMessage && !window.confirm(action.confirmMessage)) {
      return
    }

    setUpdatingId(booking.bookingId)
    setError(null)
    try {
      const response = await fetch(`/api/v1/internal/bookings/${booking.bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      })
      const payload = (await response.json().catch(() => ({}))) as
        | BookingRecord
        | { error?: string }
      if (!response.ok) {
        throw new Error(
          typeof payload === 'object' && payload && 'error' in payload && payload.error
            ? payload.error
            : 'Не удалось обновить статус'
        )
      }
      const updated = payload as BookingRecord
      setBookings((current) =>
        current.map((item) => (item.bookingId === booking.bookingId ? updated : item))
      )
      setFlashMessage(`Статус изменён на «${getStatusMeta(updated.status).label}»`)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Не удалось обновить статус')
    } finally {
      setUpdatingId(null)
    }
  }

  function renderActions(booking: BookingRecord) {
    const actions = ACTIONS[booking.status]
    if (!actions?.length) return null

    return (
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.status}
            type="button"
            className={VARIANT_STYLES[action.variant ?? 'secondary']}
            onClick={() => updateStatus(booking, action.status)}
            disabled={updatingId === booking.bookingId || loading}
          >
            {action.label}
          </button>
        ))}
      </div>
    )
  }

  function renderPayment(booking: BookingRecord) {
    const payment = booking.payment
    if (!payment) return null

    const currency = payment.currency ?? 'RUB'
    const deposit = formatCurrency(payment.dueNowAmount, currency)
    const balance = formatCurrency(payment.dueLaterAmount, currency)
    const note = payment.note

    return (
      <div className="space-y-1 text-sm text-slate-600">
        {deposit ? <p>Депозит: {deposit}</p> : null}
        {balance ? <p>Остаток: {balance}</p> : null}
        {payment.depositDueAt ? (
          <p className="text-xs text-amber-600">
            Депозит до {formatDateTime(payment.depositDueAt) ?? 'уточните у администратора'}
          </p>
        ) : null}
        {note ? <p className="text-xs text-slate-500">{note}</p> : null}
      </div>
    )
  }

  function renderBooking(booking: BookingRecord) {
    return (
      <li key={booking.bookingId} className="space-y-3 rounded-xl border p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-slate-900">{booking.client.fullName}</p>
            <p className="text-sm text-slate-600">{booking.client.phone}</p>
            {booking.client.email ? (
              <p className="text-xs text-slate-500">{booking.client.email}</p>
            ) : null}
          </div>
          <BookingStatusBadge status={booking.status} />
        </div>
        <p className="text-sm font-medium text-slate-700">
          {formatSlotRange(booking.slotStart, booking.slotEnd)}
        </p>
        <div className="space-y-2">
          {renderPayment(booking)}
          {booking.updatedAt ? (
            <p className="text-xs text-slate-500">
              Обновлено {formatDateTime(booking.updatedAt) ?? 'недавно'}
            </p>
          ) : null}
          {booking.statusHistory?.length ? (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer text-slate-600">История статусов</summary>
              <ul className="mt-2 space-y-1">
                {booking.statusHistory.map((entry, index) => (
                  <li key={`${entry.status}-${index}`}>
                    <span className="font-medium text-slate-700">
                      {formatDateTime(entry.changedAt) ?? entry.changedAt}
                    </span>{' '}
                    — {getStatusMeta(entry.status).label}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {renderActions(booking)}
        </div>
      </li>
    )
  }

  const selectedSpecialist = specialists.find((item) => item.id === selectedSpecialistId)

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="h2">Расписание специалистов</h2>
            <p className="text-sm text-slate-600">
              Отслеживайте депозиты, подтверждайте визиты и фиксируйте результаты прямо из кабинета.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              value={selectedSpecialistId}
              onChange={(event) => {
                setSelectedSpecialistId(event.target.value)
                setFlashMessage(null)
              }}
            >
              {specialists.map((specialist) => (
                <option key={specialist.id} value={specialist.id}>
                  {specialist.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50"
              disabled={loading}
            >
              Обновить
            </button>
          </div>
        </div>
        {selectedSpecialist?.title ? (
          <p className="text-sm text-slate-500">{selectedSpecialist.title}</p>
        ) : null}
        {flashMessage ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{flashMessage}</p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Всего броней</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">{bookings.length}</dd>
          </div>
          <div className="rounded-xl bg-amber-50 p-4">
            <dt className="text-xs uppercase tracking-wide text-amber-600">Ждут депозита</dt>
            <dd className="mt-1 text-2xl font-semibold text-amber-700">{awaitingDeposit.length}</dd>
          </div>
          <div className="rounded-xl bg-sky-50 p-4">
            <dt className="text-xs uppercase tracking-wide text-sky-600">Ближайшие визиты</dt>
            <dd className="mt-1 text-2xl font-semibold text-sky-700">{upcoming.length}</dd>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4">
            <dt className="text-xs uppercase tracking-wide text-emerald-600">Обновлено</dt>
            <dd className="mt-1 text-sm font-medium text-emerald-700">
              {formatDateTime(generatedAt) ?? 'только что'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card space-y-4">
        <header className="space-y-1">
          <h3 className="h3">Ожидают депозита</h3>
          <p className="text-sm text-slate-600">
            Эти клиенты забронировали слот, но ещё не внесли депозит. Свяжитесь с ними до дедлайна.
          </p>
        </header>
        {awaitingDeposit.length ? (
          <ul className="space-y-3">{awaitingDeposit.map(renderBooking)}</ul>
        ) : (
          <p className="text-sm text-slate-500">Свободных депозитов нет — все платежи получены.</p>
        )}
      </section>

      <section className="card space-y-4">
        <header className="space-y-1">
          <h3 className="h3">Ближайшие визиты</h3>
          <p className="text-sm text-slate-600">
            Подтвердите приход клиента и завершите визит после консультации — статусы синхронизируются с CRM.
          </p>
        </header>
        {upcoming.length ? (
          <ul className="space-y-3">{upcoming.map(renderBooking)}</ul>
        ) : (
          <p className="text-sm text-slate-500">Ближайших визитов нет.</p>
        )}
      </section>

      <section className="card space-y-4">
        <header className="space-y-1">
          <h3 className="h3">История визитов</h3>
          <p className="text-sm text-slate-600">
            Последние 10 визитов с комментариями и статусами для сверки с выплатами.
          </p>
        </header>
        {history.length ? (
          <ul className="space-y-3">{history.map(renderBooking)}</ul>
        ) : (
          <p className="text-sm text-slate-500">История пуста — начните с предстоящих записей.</p>
        )}
      </section>
    </div>
  )
}
