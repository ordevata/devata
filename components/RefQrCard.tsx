
'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

export default function RefQrCard({ refId }: { refId: string }){
  const [png, setPng] = useState<string>('')
  const [url, setUrl] = useState<string>('')

  async function generate(){
    const res = await api('/referrals/qr', { method: 'POST', body: JSON.stringify({ ref_id: refId }) })
    setPng(res.qrcode_png)
    setUrl(res.join_url)
  }

  return (
    <div className="card space-y-3">
      <div className="h2">QR приглашение</div>
      <button onClick={generate} className="border px-3 py-1 rounded">Сгенерировать</button>
      {png && <img src={png} alt="QR" className="w-48 h-48" />}
      {url && <div className="text-sm break-all">{url}</div>}
    </div>
  )
}
