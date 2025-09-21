import type { BookingStatus } from '@/lib/booking-types'

export type BookingStatusMeta = {
  label: string
  className: string
}

export const STATUS_META: Record<BookingStatus, BookingStatusMeta> = {
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

const FALLBACK_META: BookingStatusMeta = {
  label: 'Статус неизвестен',
  className: 'bg-slate-100 text-slate-700 border border-slate-200'
}

export function getStatusMeta(status: BookingStatus): BookingStatusMeta {
  return STATUS_META[status] ?? FALLBACK_META
}

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const meta = getStatusMeta(status)
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  )
}
