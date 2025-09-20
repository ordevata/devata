import { NextRequest, NextResponse } from 'next/server'

import { demoServices } from '@/lib/demo-data'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const centerId = searchParams.get('center_id') ?? undefined

  const services = centerId
    ? demoServices.filter((service) =>
        service.centerIds ? service.centerIds.includes(centerId) : true
      )
    : demoServices

  return NextResponse.json(services, {
    headers: { 'Cache-Control': 'no-store' }
  })
}
