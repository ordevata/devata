
import { SpecialistDashboard } from '@/components/SpecialistDashboard'
import { getSpecialists, listBookings } from '@/lib/booking'

export default async function Page() {
  const specialists = await getSpecialists()

  if (!specialists.length) {
    return (
      <section className="card space-y-3">
        <h1 className="h1">Кабинет специалиста</h1>
        <p className="text-sm text-slate-600">
          В демо-данных пока нет специалистов. Добавьте специалистов в демо-набор, чтобы увидеть расписание.
        </p>
      </section>
    )
  }

  const initialSpecialistId = specialists[0]?.id
  const initialData = initialSpecialistId
    ? await listBookings({ specialistId: initialSpecialistId })
    : { bookings: [], total: 0, generatedAt: new Date().toISOString() }

  return (
    <div className="space-y-8">
      <header className="card space-y-3">
        <h1 className="h1">Кабинет специалиста</h1>
        <p className="text-sm text-slate-600">
          Управляйте расписанием, депозитами и статусами визитов клиентов. Все изменения синхронизируются с демо-API и n8n.
        </p>
      </header>
      <SpecialistDashboard
        specialists={specialists}
        initialSpecialistId={initialSpecialistId}
        initialData={initialData}
      />
    </div>
  )
}
