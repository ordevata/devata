const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' })
const timeFormatter = new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' })

const currencyFormatters = new Map<string, Intl.NumberFormat>()

export function parseDate(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDateTime(value?: string): string | null {
  const parsed = parseDate(value)
  return parsed ? dateTimeFormatter.format(parsed) : null
}

export function formatDate(value?: string): string | null {
  const parsed = parseDate(value)
  return parsed ? dateFormatter.format(parsed) : null
}

export function formatTime(value?: string): string | null {
  const parsed = parseDate(value)
  return parsed ? timeFormatter.format(parsed) : null
}

export function formatCurrency(
  amount?: number,
  currency = 'RUB',
  options: Intl.NumberFormatOptions = {}
): string | null {
  if (amount == null) return null
  const key = `${currency}-${options.maximumFractionDigits ?? 'default'}`
  let formatter = currencyFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: options.maximumFractionDigits ?? 0
    })
    currencyFormatters.set(key, formatter)
  }
  return formatter.format(amount)
}

export function formatSlotRange(startIso: string, endIso: string): string {
  const start = parseDate(startIso)
  const end = parseDate(endIso)
  if (!start || !end) return 'Дата не указана'
  const sameDay = start.toDateString() === end.toDateString()
  if (sameDay) {
    return `${dateFormatter.format(start)}, ${timeFormatter.format(start)}–${timeFormatter.format(end)}`
  }
  return `${dateTimeFormatter.format(start)} — ${dateTimeFormatter.format(end)}`
}
