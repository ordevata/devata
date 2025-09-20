
'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'

import ScheduleGrid from '@/components/ScheduleGrid'
import {
  createBooking,
  getCenters,
  getServices,
  getSlots,
  getSpecialists,
  type BookingRequest,
  type Center,
  type Service,
  type Slot,
  type Specialist
} from '@/lib/booking'

const TIMEZONE = 'Europe/Moscow'

type StatusMessage = {
  type: 'success' | 'error'
  title: string
  message: string
}

export default function Page() {
  const [centers, setCenters] = useState<Center[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [specialists, setSpecialists] = useState<Specialist[]>([])
  const [slots, setSlots] = useState<Slot[]>([])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)

  const [selectedCenterId, setSelectedCenterId] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [selectedSpecialistId, setSelectedSpecialistId] = useState('')
  const [selectedSlotId, setSelectedSlotId] = useState('')

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    comment: '',
    preferredChannel: 'whatsapp' as const
  })

  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const selectedCenter = centers.find((center) => center.id === selectedCenterId) ?? null
  const selectedService = services.find((service) => service.id === selectedServiceId) ?? null
  const selectedSpecialist =
    specialists.find((specialist) => specialist.id === selectedSpecialistId) ?? null
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumFractionDigits: 0
      }),
    []
  )

  type PricingSummary = {
    total: number
    dueNow: number
    dueLater: number
    isOptional: boolean
    note?: string
  }

  const pricingSummary = useMemo<PricingSummary | null>(() => {
    if (!selectedService?.price) return null

    const price = selectedService.price
    const depositPercent = selectedService.depositPercent ?? 0
    const depositAmount = Math.min(price, Math.max(0, Math.round((price * depositPercent) / 100)))
    const paymentPolicy = selectedService.paymentPolicy ?? 'none'
    const depositDueMinutes = selectedService.depositDueMinutes

    switch (paymentPolicy) {
      case 'full_prepaid':
        return {
          total: price,
          dueNow: price,
          dueLater: 0,
          isOptional: false,
          note: 'Место подтверждается после полной онлайн-оплаты.'
        }
      case 'deposit_required':
        return {
          total: price,
          dueNow: depositAmount,
          dueLater: Math.max(0, price - depositAmount),
          isOptional: false,
          note:
            depositDueMinutes != null
              ? `Слот удерживается ${depositDueMinutes} минут после бронирования. Если депозит не поступает, бронь отменяется.`
              : 'Слот удерживается ограниченное время до поступления депозита.'
        }
      case 'deposit_optional':
        return {
          total: price,
          dueNow: depositAmount,
          dueLater: Math.max(0, price - depositAmount),
          isOptional: true,
          note:
            depositDueMinutes != null
              ? `Можно внести депозит, чтобы закрепить время. Рекомендуем оплатить в течение ${depositDueMinutes} минут.`
              : 'Можно внести депозит, чтобы закрепить время, либо оплатить всё в день визита.'
        }
      default:
        return {
          total: price,
          dueNow: 0,
          dueLater: price,
          isOptional: true,
          note: 'Оплата производится в центре в день визита.'
        }
    }
  }, [selectedService])

  const paymentHint = useMemo(() => {
    if (!selectedService) return null
    const paymentPolicy = selectedService.paymentPolicy ?? 'none'

    switch (paymentPolicy) {
      case 'full_prepaid':
        return 'Для фиксации записи требуется полная оплата онлайн.'
      case 'deposit_required':
        return 'Для подтверждения записи нужно внести депозит. Остаток оплачивается в день визита.'
      case 'deposit_optional':
        return 'Можно внести депозит, чтобы закрепить время. Если не успеете, оплатите полностью в день визита.'
      default:
        return 'Предоплата не требуется — оплата производится в центре в день визита.'
    }
  }, [selectedService])

  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const [centersData, servicesData, specialistsData] = await Promise.all([
          getCenters(),
          getServices(),
          getSpecialists()
        ])
        if (!active) return
        setCenters(centersData)
        setServices(servicesData)
        setSpecialists(specialistsData)
      } catch (error) {
        if (!active) return
        console.error('Не удалось загрузить справочники', error)
        setLoadError('Не удалось загрузить данные. Проверьте соединение с API или используйте демо-данные.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (centers.length && !selectedCenterId) {
      setSelectedCenterId(centers[0].id)
    }
  }, [centers, selectedCenterId])

  const availableServices = useMemo(() => {
    if (!selectedCenterId) return services
    return services.filter((service) => {
      if (!service.centerIds?.length) return true
      return service.centerIds.includes(selectedCenterId)
    })
  }, [services, selectedCenterId])

  useEffect(() => {
    if (!availableServices.length) {
      setSelectedServiceId('')
      return
    }
    if (!selectedServiceId || !availableServices.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(availableServices[0].id)
    }
  }, [availableServices, selectedServiceId])

  const availableSpecialists = useMemo(() => {
    return specialists.filter((specialist) => {
      if (selectedCenterId && !specialist.centerIds.includes(selectedCenterId)) return false
      if (selectedServiceId && !specialist.serviceIds.includes(selectedServiceId)) return false
      return true
    })
  }, [specialists, selectedCenterId, selectedServiceId])

  useEffect(() => {
    if (!availableSpecialists.length) {
      setSelectedSpecialistId('')
      return
    }
    if (!selectedSpecialistId || !availableSpecialists.some((specialist) => specialist.id === selectedSpecialistId)) {
      setSelectedSpecialistId(availableSpecialists[0].id)
    }
  }, [availableSpecialists, selectedSpecialistId])

  useEffect(() => {
    if (!selectedCenterId || !selectedServiceId || !selectedSpecialistId) {
      setSlots([])
      setSelectedSlotId('')
      return
    }

    let active = true
    setSlotsLoading(true)
    setSlotError(null)
    const from = new Date().toISOString()
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

    ;(async () => {
      try {
        const loadedSlots = await getSlots({
          centerId: selectedCenterId,
          serviceId: selectedServiceId,
          specialistId: selectedSpecialistId,
          from,
          to
        })
        if (!active) return
        setSlots(loadedSlots)
        if (loadedSlots.length) {
          setSelectedSlotId((current) =>
            current && loadedSlots.some((slot) => slot.id === current) ? current : loadedSlots[0].id
          )
        } else {
          setSelectedSlotId('')
        }
      } catch (error) {
        if (!active) return
        console.error('Не удалось загрузить свободные слоты', error)
        setSlots([])
        setSelectedSlotId('')
        setSlotError('Не удалось получить список свободных слотов. Проверьте API `/booking/slots` или воспользуйтесь демо-данными из `lib/booking.ts`.')
      } finally {
        if (active) setSlotsLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [selectedCenterId, selectedServiceId, selectedSpecialistId])

  const onChangeInput = (field: 'fullName' | 'phone' | 'email' | 'comment') =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }))
    }

  const onChangeChannel = (event: ChangeEvent<HTMLSelectElement>) => {
    setForm((current) => ({ ...current, preferredChannel: event.target.value as typeof current.preferredChannel }))
  }

  const formatSlotForSummary = (slot: Slot | null) => {
    if (!slot) return '—'
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TIMEZONE
    })
    const endFormatter = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TIMEZONE
    })
    return `${formatter.format(Date.parse(slot.start))} — ${endFormatter.format(Date.parse(slot.end))}`
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus(null)

    if (!selectedCenter || !selectedService || !selectedSpecialist || !selectedSlot) {
      setStatus({
        type: 'error',
        title: 'Не хватает данных',
        message: 'Выберите центр, услугу, специалиста и свободное время.'
      })
      return
    }

    if (!form.fullName.trim() || !form.phone.trim()) {
      setStatus({
        type: 'error',
        title: 'Контактные данные обязательны',
        message: 'Введите ФИО и номер телефона, чтобы мы могли подтвердить запись.'
      })
      return
    }

    setSubmitting(true)

    const payload: BookingRequest = {
      centerId: selectedCenter.id,
      serviceId: selectedService.id,
      specialistId: selectedSpecialist.id,
      slotId: selectedSlot.id,
      client: {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        comment: form.comment.trim() || undefined,
        preferredChannel: form.preferredChannel
      },
      metadata: {
        source: 'next-app',
        createdAt: new Date().toISOString()
      }
    }

    try {
      const response = await createBooking(payload)
      const successTitle = response.status === 'simulated' ? 'Заявка сохранена' : 'Бронь создана'
      const successMessage =
        response.status === 'simulated'
          ? 'API пока не подключено, поэтому заявка сохранена в демо-режиме. После подключения backend брони будут подтверждаться автоматически.'
          : 'Мы получили вашу заявку и отправим подтверждение по выбранному каналу связи.'

      setStatus({
        type: 'success',
        title: successTitle,
        message: `${successMessage} ID: ${response.bookingId}`
      })
    } catch (error) {
      console.error('Не удалось создать бронь', error)
      setStatus({
        type: 'error',
        title: 'Ошибка при создании брони',
        message:
          error instanceof Error
            ? error.message
            : 'Неизвестная ошибка. Проверьте API `/booking` и повторите попытку.'
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-2">
          <h1 className="h1">Онлайн-запись DEVATA</h1>
          <p className="text-sm text-slate-600">
            Выберите центр, услугу и удобное время. После подтверждения менеджер отправит уведомление в выбранный канал связи.
          </p>
        </header>

        {loadError ? (
          <div className="rounded-2xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-800">
            {loadError}
          </div>
        ) : null}

        <form className="space-y-8" onSubmit={handleSubmit}>
          <section className="card space-y-4">
            <h2 className="h2">1. Локация и услуга</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Центр DEVATA</span>
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2"
                  value={selectedCenterId}
                  onChange={(event) => setSelectedCenterId(event.target.value)}
                  disabled={loading || !centers.length}
                >
                  {centers.map((center) => (
                    <option key={center.id} value={center.id}>
                      {center.city} · {center.name}
                    </option>
                  ))}
                </select>
                {selectedCenter?.address ? (
                  <span className="text-xs text-slate-500">
                    {selectedCenter.address}
                    {selectedCenter.metro ? ` · м. ${selectedCenter.metro}` : ''}
                  </span>
                ) : null}
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Услуга</span>
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2"
                  value={selectedServiceId}
                  onChange={(event) => setSelectedServiceId(event.target.value)}
                  disabled={!availableServices.length}
                >
                  {availableServices.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
                {selectedService?.description ? (
                  <span className="text-xs text-slate-500">{selectedService.description}</span>
                ) : null}
                {selectedService ? (
                  <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                    <div className="flex items-baseline justify-between gap-2 text-slate-700">
                      <span className="font-medium">Стоимость визита</span>
                      {selectedService.price != null ? (
                        <span>{currencyFormatter.format(selectedService.price)}</span>
                      ) : null}
                    </div>
                    {selectedService.depositPercent != null ? (
                      <div className="mt-1 text-slate-500">
                        Депозит: {selectedService.depositPercent}% от стоимости.
                      </div>
                    ) : null}
                    {paymentHint ? <div className="mt-2 text-slate-500">{paymentHint}</div> : null}
                  </div>
                ) : null}
              </label>
            </div>
          </section>

          <section className="card space-y-4">
            <h2 className="h2">2. Специалист</h2>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Выберите специалиста</span>
              <select
                className="rounded-xl border border-slate-200 px-3 py-2"
                value={selectedSpecialistId}
                onChange={(event) => setSelectedSpecialistId(event.target.value)}
                disabled={!availableSpecialists.length}
              >
                {availableSpecialists.map((specialist) => (
                  <option key={specialist.id} value={specialist.id}>
                    {specialist.fullName}
                  </option>
                ))}
              </select>
              {!availableSpecialists.length ? (
                <span className="text-xs text-rose-600">
                  Для выбранной услуги в этом центре пока нет специалистов. Попробуйте выбрать другую локацию или услугу.
                </span>
              ) : null}
            </label>
            {selectedSpecialist?.bio ? (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{selectedSpecialist.bio}</p>
            ) : null}
          </section>

          <section className="card space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="h2">3. Время визита</h2>
              <span className="text-xs text-slate-500">Отображаем ближайшие 14 дней</span>
            </div>
            <ScheduleGrid
              slots={slots}
              selectedSlotId={selectedSlotId}
              onSelect={(slotId) => setSelectedSlotId(slotId)}
              loading={slotsLoading}
              timezone={TIMEZONE}
              emptyMessage={slotError ?? 'Свободных слотов нет. Попробуйте выбрать другую дату или специалиста.'}
            />
          </section>

          <section className="card space-y-4">
            <h2 className="h2">4. Контактные данные</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  ФИО <span className="text-rose-600">*</span>
                </span>
                <input
                  type="text"
                  className="rounded-xl border border-slate-200 px-3 py-2"
                  value={form.fullName}
                  onChange={onChangeInput('fullName')}
                  placeholder="Например, Анна Петрова"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">
                  Телефон <span className="text-rose-600">*</span>
                </span>
                <input
                  type="tel"
                  className="rounded-xl border border-slate-200 px-3 py-2"
                  value={form.phone}
                  onChange={onChangeInput('phone')}
                  placeholder="+7 (___) ___-__-__"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Email</span>
                <input
                  type="email"
                  className="rounded-xl border border-slate-200 px-3 py-2"
                  value={form.email}
                  onChange={onChangeInput('email')}
                  placeholder="name@example.com"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Предпочтительный канал связи</span>
                <select
                  className="rounded-xl border border-slate-200 px-3 py-2"
                  value={form.preferredChannel}
                  onChange={onChangeChannel}
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="email">Email</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Комментарий</span>
              <textarea
                className="min-h-[100px] rounded-xl border border-slate-200 px-3 py-2"
                value={form.comment}
                onChange={onChangeInput('comment')}
                placeholder="Расскажите, какая помощь вам нужна или когда удобно связаться."
              />
            </label>
          </section>

          <section className="card space-y-4">
            <h2 className="h2">5. Проверка и подтверждение</h2>
            <ul className="space-y-1 text-sm text-slate-600">
              <li>
                <span className="font-medium text-slate-700">Центр:</span> {selectedCenter ? `${selectedCenter.city}, ${selectedCenter.name}` : '—'}
              </li>
              <li>
                <span className="font-medium text-slate-700">Услуга:</span> {selectedService ? selectedService.name : '—'}
              </li>
              <li>
                <span className="font-medium text-slate-700">Специалист:</span> {selectedSpecialist ? selectedSpecialist.fullName : '—'}
              </li>
              <li>
                <span className="font-medium text-slate-700">Время визита:</span> {formatSlotForSummary(selectedSlot)}
              </li>
              <li>
                <span className="font-medium text-slate-700">Канал связи:</span>{' '}
                {form.preferredChannel === 'whatsapp'
                  ? 'WhatsApp'
                  : form.preferredChannel === 'telegram'
                    ? 'Telegram'
                    : 'Email'}
              </li>
            </ul>

            {pricingSummary ? (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                <div className="font-medium text-slate-700">Финансовые условия визита</div>
                <dl className="mt-3 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Итого</dt>
                    <dd>{currencyFormatter.format(pricingSummary.total)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">
                      К оплате сейчас{pricingSummary.isOptional ? ' (по желанию)' : ''}
                    </dt>
                    <dd>
                      {pricingSummary.dueNow === 0
                        ? 'Не требуется'
                        : currencyFormatter.format(pricingSummary.dueNow)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Остаток на визите</dt>
                    <dd>
                      {pricingSummary.dueLater === 0
                        ? '—'
                        : currencyFormatter.format(pricingSummary.dueLater)}
                    </dd>
                  </div>
                </dl>
                {pricingSummary.note ? (
                  <p className="mt-3 text-xs text-slate-500">{pricingSummary.note}</p>
                ) : null}
              </div>
            ) : null}

            {status ? (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  status.type === 'success'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-rose-500 bg-rose-50 text-rose-700'
                }`}
              >
                <div className="font-medium">{status.title}</div>
                <div>{status.message}</div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  submitting ||
                  loading ||
                  !selectedCenter ||
                  !selectedService ||
                  !selectedSpecialist ||
                  !selectedSlot
                }
              >
                {submitting ? 'Отправляем...' : 'Подтвердить запись'}
              </button>
              <span className="text-xs text-slate-500">
                Подтверждая запись, вы соглашаетесь с обработкой персональных данных и политикой отмены DEVATA.
              </span>
            </div>
          </section>
        </form>
      </div>
    </div>
  )
}
