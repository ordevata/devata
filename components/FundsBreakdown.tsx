
export default function FundsBreakdown({ total }: { total: number }){
  const mlm = +(total * 0.26).toFixed(2)
  const ops = +(total * 0.74).toFixed(2)
  return (
    <div className="card">
      <div className="h2 mb-2">Фонды 26% / 74%</div>
      <div className="mono grid grid-cols-2 gap-4">
        <div>Итого: {total.toLocaleString('ru-RU')} ₽</div>
        <div>MLM фонд (26%): {mlm.toLocaleString('ru-RU')} ₽</div>
        <div>DEVATA фонд (74%): {ops.toLocaleString('ru-RU')} ₽</div>
      </div>
    </div>
  )
}
