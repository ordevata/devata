import { NextResponse } from 'next/server'

import { demoCenters } from '@/lib/demo-data'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(demoCenters, {
    headers: { 'Cache-Control': 'no-store' }
  })
}
