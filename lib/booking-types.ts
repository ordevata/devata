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

export type BookingClient = {
  fullName: string
  phone: string
  email?: string
  comment?: string
  preferredChannel?: 'email' | 'telegram' | 'whatsapp'
}

export type BookingRequest = {
  centerId: string
  serviceId: string
  specialistId: string
  slotId: string
  client: BookingClient
  metadata?: Record<string, unknown>
}

export type BookingStatus = 'reserved' | 'confirmed' | 'simulated'

export type BookingResponse = {
  bookingId: string
  status: BookingStatus
  slotStart: string
  slotEnd: string
}
