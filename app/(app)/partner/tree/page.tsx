
import FundsBreakdown from '@/components/FundsBreakdown'
import RefQrCard from '@/components/RefQrCard'

export default function Page(){
  return (
    <div className='grid gap-6'>
      <div className='h2'>Моя партнёрская структура</div>
      <FundsBreakdown total={100000}/>
      <RefQrCard refId={'00000000-0000-0000-0000-000000000000'}/>
      <div className='card'>Дерево 5 уровней (TODO: визуализация)</div>
    </div>
  )
}
