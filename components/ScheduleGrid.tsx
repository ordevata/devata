'use client'

import { useMemo } from 'react'

import type { Slot } from '@/lib/booking'

type Props = {
  slots: Slot[]
  selectedSlotId?: string
  onSelect: (slotId: string) => void
  loading?: boolean
  timezone?: string
  emptyMessage?: string
  className?: string
}

type SlotGroup = {
  date: string
  label: string
  slots: Slot[]
}

const weekdayFormatter = (timezone?: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone ?? 'Europe/Moscow'
  })

const timeFormatter = (timezone?: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone ?? 'Europe/Moscow'
  })

function formatRange(slot: Slot, timezone?: string) {
  const formatter = timeFormatter(timezone)
  return `${formatter.format(Date.parse(slot.start))} — ${formatter.format(Date.parse(slot.end))}`
}

function groupSlots(slots: Slot[], timezone?: string): SlotGroup[] {
  const formatter = weekdayFormatter(timezone)
  const map = new Map<string, SlotGroup>()

  for (const slot of slots) {
    const date = new Date(Date.parse(slot.start))
    const dayKey = date.toISOString().slice(0, 10)
    if (!map.has(dayKey)) {
      map.set(dayKey, {
        date: dayKey,
        label: formatter.format(date),
        slots: []
      })
    }
    map.get(dayKey)?.slots.push(slot)
  }

  return Array.from(map.values())
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((group) => ({
      ...group,
      slots: group.slots.sort((a, b) => (a.start < b.start ? -1 : 1))
    }))
}

export default function ScheduleGrid({
  slots,
  selectedSlotId,
  onSelect,
  loading,
  timezone,
  emptyMessage,
  className
}: Props) {
  const groups = useMemo(() => groupSlots(slots, timezone), [slots, timezone])

  if (loading) {
    return (
      <div className={className}>
        <div className="animate-pulse rounded-2xl border p-6">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 rounded-xl bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!groups.length) {
    return (
      <div className={className}>
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">
          {emptyMessage ?? 'В ближайшие дни свободных слотов нет. Попробуйте выбрать другого специалиста или дату.'}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.date} className="rounded-2xl border p-5">
            <header className="mb-3 flex items-baseline justify-between gap-3">
              <span className="font-medium capitalize">{group.label}</span>
              <span className="text-xs uppercase tracking-wide text-slate-500">{group.slots.length} слота</span>
            </header>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.slots.map((slot) => {
                const disabled = slot.remaining <= 0
                const isSelected = slot.id === selectedSlotId
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => onSelect(slot.id)}
                    disabled={disabled}
                    className={[
                      'flex w-full flex-col items-start rounded-xl border px-4 py-3 text-left transition',
                      isSelected
                        ? 'border-slate-900 bg-slate-900 text-white shadow'
                        : 'border-slate-200 bg-white hover:border-slate-400 hover:shadow',
                      disabled && !isSelected ? 'opacity-50 hover:shadow-none' : ''
                    ].join(' ')}
                  >
                    <span className="text-sm font-medium">{formatRange(slot, timezone)}</span>
                    <span className="mt-1 text-xs text-slate-500">
                      {disabled ? 'Слот занят' : slot.remaining === slot.capacity ? 'Свободно' : `Осталось ${slot.remaining}`}
                    </span>
                    {slot.room ? <span className="mt-1 text-xs text-slate-400">{slot.room}</span> : null}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
