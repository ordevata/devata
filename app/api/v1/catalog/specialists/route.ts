import { NextRequest, NextResponse } from 'next/server'

import { demoSpecialists } from '@/lib/demo-data'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const centerId = searchParams.get('center_id') ?? undefined
  const serviceId = searchParams.get('service_id') ?? undefined

  const specialists = demoSpecialists.filter((specialist) => {
    if (centerId && !specialist.centerIds.includes(centerId)) {
      return false
    }
    if (serviceId && !specialist.serviceIds.includes(serviceId)) {
      return false
    }
    return true
  })

  return NextResponse.json(specialists, {
    headers: { 'Cache-Control': 'no-store' }
  })
}
