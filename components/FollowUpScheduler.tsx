'use client'

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import ScheduleGrid from '@/components/ScheduleGrid'
import {
  createFollowUpBooking,
  getSlots,
  type BookingFollowUpRequest,
  type BookingRecord,
  type Slot
} from '@/lib/booking'
import { formatSlotRange } from '@/lib/formatters'

type FollowUpSchedulerProps = {
  booking: BookingRecord | null
  open: boolean
  onClose: () => void
  onCreated: (booking: BookingRecord) => Promise<void> | void
  timezone?: string
}

const FOLLOW_UP_WINDOW_DAYS = 21
const MS_PER_DAY = 24 * 60 * 60 * 1000
const NOTE_MAX_LENGTH = 500

export function FollowUpScheduler({
  booking,
  open,
  onClose,
  onCreated,
  timezone
}: FollowUpSchedulerProps) {
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState<string | undefined>()
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const selectedSlot = useMemo(
    () => slots.find((slot) => slot.id === selectedSlotId),
    [slots, selectedSlotId]
  )

  const loadSlots = useCallback(async () => {
    if (!booking) return

    setLoadingSlots(true)
    setError(null)

    const startReference = Math.max(
      Date.now(),
      Date.parse(booking.slotEnd ?? booking.slotStart)
    )
    const from = new Date(startReference).toISOString()
    const to = new Date(startReference + FOLLOW_UP_WINDOW_DAYS * MS_PER_DAY).toISOString()

    try {
      const fetched = await getSlots({
        centerId: booking.centerId,
        serviceId: booking.serviceId,
        specialistId: booking.specialistId,
        from,
        to
      })
      setSlots(fetched)
      setSelectedSlotId((current) => {
        if (!current) {
          return fetched[0]?.id
        }
        return fetched.some((slot) => slot.id === current) ? current : fetched[0]?.id
      })
    } catch (slotError) {
      setSlots([])
      setSelectedSlotId(undefined)
      setError(
        slotError instanceof Error
          ? slotError.message
          : 'Не удалось загрузить свободные слоты'
      )
    } finally {
      setLoadingSlots(false)
    }
  }, [booking])

  useEffect(() => {
    if (open && booking) {
      loadSlots()
      setNote('')
    }
  }, [open, booking, loadSlots])

  useEffect(() => {
    if (!open) {
      setSlots([])
      setSelectedSlotId(undefined)
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  if (!open || !booking) {
    return null
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!selectedSlotId) {
      setError('Выберите свободный слот для follow-up')
      return
    }

    if (!booking) {
      setError('Исходная бронь не найдена — обновите страницу')
      return
    }

    setSubmitting(true)
    setError(null)

    const payload: BookingFollowUpRequest = {
      slotId: selectedSlotId,
      note: note.trim() ? note.trim() : undefined
    }

    try {
      const followUpBooking = await createFollowUpBooking(booking.bookingId, payload)
      await onCreated(followUpBooking)
      onClose()
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Не удалось назначить follow-up'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6"
      onClick={() => {
        if (!submitting) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="space-y-1">
          <p className="text-sm font-medium text-emerald-600">Follow-up для {booking.client.fullName}</p>
          <h2 className="text-2xl font-semibold text-slate-900">Назначить следующий визит</h2>
          <p className="text-sm text-slate-600">
            Текущая бронь: {formatSlotRange(booking.slotStart, booking.slotEnd)} ·{' '}
            {booking.client.phone}
          </p>
        </header>

        <section className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-slate-700">Свободные слоты в ближайшие недели</h3>
            <button
              type="button"
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
              onClick={() => loadSlots()}
              disabled={loadingSlots || submitting}
            >
              Обновить
            </button>
          </div>

          <ScheduleGrid
            slots={slots}
            selectedSlotId={selectedSlotId}
            onSelect={setSelectedSlotId}
            loading={loadingSlots}
            timezone={timezone}
            emptyMessage="В ближайшие дни нет свободных слотов — попробуйте обновить или выбрать другой день."
            className="max-h-[360px] overflow-y-auto pr-1"
          />
        </section>

        <section className="mt-6 space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="follow-up-note">
            Комментарий для записи (необязательно)
          </label>
          <textarea
            id="follow-up-note"
            value={note}
            onChange={(event) => {
              if (event.target.value.length <= NOTE_MAX_LENGTH) {
                setNote(event.target.value)
              }
            }}
            className="h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="Например: обсудить результаты упражнения, подготовить материалы"
            disabled={submitting}
          />
          <p className="text-xs text-slate-500">
            {note.length}/{NOTE_MAX_LENGTH} символов
          </p>
        </section>

        {selectedSlot ? (
          <section className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-medium text-slate-800">Выбранный слот</p>
            <p className="mt-1">{formatSlotRange(selectedSlot.start, selectedSlot.end)}</p>
            {selectedSlot.room ? (
              <p className="mt-1 text-xs text-slate-500">Кабинет: {selectedSlot.room}</p>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}

        <footer className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            disabled={submitting}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-wait disabled:bg-emerald-300"
            disabled={submitting || !selectedSlotId}
          >
            Назначить визит
          </button>
        </footer>
      </form>
    </div>
  )
}
