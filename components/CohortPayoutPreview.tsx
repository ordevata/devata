
'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

export default function CohortPayoutPreview({ cohortId }:{cohortId:string}){
  const [data,setData] = useState<any>(null)
  useEffect(()=>{ api(`/cohorts/${cohortId}/payouts/preview`).then(setData).catch(()=>{}) },[cohortId])
  if(!data) return <div className="card">Загрузка...</div>
  return (
    <div className="card space-y-2">
      <div className="h2">Выплаты по группе</div>
      <div className="mono grid gap-1">
        <div>Сумма группы: {data.group_total?.toLocaleString('ru-RU')} ₽</div>
        <div>MLM фонд 26%: {data.mlm_fund_26?.toLocaleString('ru-RU')} ₽</div>
        <div>DEVATA фонд 74%: {data.ops_fund_74?.toLocaleString('ru-RU')} ₽</div>
        <div>Пул лекторов ({(data.lecturer_pool_percent*100).toFixed(0)}%): {data.lecturer_pool_total?.toLocaleString('ru-RU')} ₽</div>
        <div>Пул ассистентов ({(data.assistant_pool_percent*100).toFixed(0)}%): {data.assistant_pool_total?.toLocaleString('ru-RU')} ₽</div>
        <div>Лектору (каждому): {data.lecturer_payout_each?.toLocaleString('ru-RU')} ₽</div>
        <div>Ассистенту (каждому): {data.assistant_payout_each?.toLocaleString('ru-RU')} ₽</div>
      </div>
    </div>
  )
}
