import { NextResponse } from 'next/server'

import { getDemoPartnerPayoutSnapshot } from '@/lib/demo-data'

export async function GET() {
  const snapshot = getDemoPartnerPayoutSnapshot()
  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'no-store'
    }
  })
}
