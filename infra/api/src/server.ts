import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL, pathToFileURL } from 'node:url'

import type { BookingListFilters, BookingRequest, BookingStatus } from './demo/booking-types.js'
import {
  DemoBookingError,
  createDemoBooking,
  demoCenters,
  demoServices,
  demoSpecialists,
  getDemoSlots,
  queryDemoBookings
} from './demo/data.js'

function setDefaultHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Content-Security-Policy', "default-src 'none'")
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
}

function asQueryString(value: string | null): string | undefined {
  return value ?? undefined
}

const ALLOWED_STATUSES: BookingStatus[] = ['reserved', 'expired', 'confirmed', 'simulated']

function validateBookingPayload(payload: BookingRequest): void {
  if (!payload.centerId) throw new Error('centerId обязателен')
  if (!payload.serviceId) throw new Error('serviceId обязателен')
  if (!payload.specialistId) throw new Error('specialistId обязателен')
  if (!payload.slotId) throw new Error('slotId обязателен')
  if (!payload.client?.fullName) throw new Error('fullName обязателен')
  if (!payload.client?.phone) throw new Error('phone обязателен')
}

function parseIsoDate(value: string | undefined, field: 'from' | 'to'): string | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Параметр ${field} должен быть в формате ISO 8601`)
  }
  return value
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Параметр limit должен быть положительным целым числом')
  }
  return parsed
}

async function readJsonBody<T>(req: IncomingMessage, maxBytes = 1_048_576): Promise<T> {
  const chunks: Uint8Array[] = []
  let total = 0

  return await new Promise<T>((resolve, reject) => {
    req.on('data', (chunk: Uint8Array) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new Error('Payload слишком большой'))
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks)
        if (buffer.length === 0) {
          resolve({} as T)
          return
        }
        const parsed = JSON.parse(buffer.toString('utf8')) as T
        resolve(parsed)
      } catch (error) {
        reject(new Error('Некорректный JSON'))
      }
    })

    req.on('error', (error) => {
      reject(error)
    })
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown, options: { cacheControl?: string } = {}): void {
  const payload = JSON.stringify(body)
  if (!res.hasHeader('Cache-Control')) {
    res.setHeader('Cache-Control', options.cacheControl ?? 'no-store')
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload, 'utf8'))
  res.end(payload)
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'))
  res.end(body)
}

function createRequestHandler() {
  return async (req: IncomingMessage, res: ServerResponse) => {
    setDefaultHeaders(res)

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Content-Length', '0')
      res.end()
      return
    }

    const origin = req.headers.host ? `http://${req.headers.host}` : 'http://localhost'
    const requestUrl = new URL(req.url ?? '/', origin)
    const { pathname } = requestUrl

    try {
      if (req.method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, { ok: true }, { cacheControl: 'no-store' })
        return
      }

      if (req.method === 'GET' && pathname === '/') {
        sendText(res, 200, 'DEVATA API: ok')
        return
      }

      if (req.method === 'GET' && pathname === '/v1') {
        sendJson(res, 200, { name: 'devata-api', version: 'demo' })
        return
      }

      if (req.method === 'GET' && pathname === '/v1/catalog/centers') {
        sendJson(res, 200, demoCenters)
        return
      }

      if (req.method === 'GET' && pathname === '/v1/catalog/services') {
        const centerId = asQueryString(requestUrl.searchParams.get('center_id'))

        const services = centerId
          ? demoServices.filter((service) =>
              service.centerIds ? service.centerIds.includes(centerId) : true
            )
          : demoServices

        sendJson(res, 200, services)
        return
      }

      if (req.method === 'GET' && pathname === '/v1/catalog/specialists') {
        const centerId = asQueryString(requestUrl.searchParams.get('center_id'))
        const serviceId = asQueryString(requestUrl.searchParams.get('service_id'))

        const specialists = demoSpecialists.filter((specialist) => {
          if (centerId && !specialist.centerIds.includes(centerId)) {
            return false
          }
          if (serviceId && !specialist.serviceIds.includes(serviceId)) {
            return false
          }
          return true
        })

        sendJson(res, 200, specialists)
        return
      }

      if (req.method === 'GET' && pathname === '/v1/booking/slots') {
        const centerId = asQueryString(requestUrl.searchParams.get('center_id'))
        const serviceId = asQueryString(requestUrl.searchParams.get('service_id'))
        const specialistId = asQueryString(requestUrl.searchParams.get('specialist_id'))
        const fromParam = asQueryString(requestUrl.searchParams.get('from'))
        const toParam = asQueryString(requestUrl.searchParams.get('to'))
        const limitParam = asQueryString(requestUrl.searchParams.get('limit'))

        if (!centerId || !serviceId || !specialistId) {
          sendJson(res, 400, { error: 'center_id, service_id и specialist_id обязательны' })
          return
        }

        let from: string | undefined
        let to: string | undefined
        let limit: number | undefined

        try {
          from = parseIsoDate(fromParam, 'from')
          to = parseIsoDate(toParam, 'to')
          limit = parsePositiveInteger(limitParam)
        } catch (error) {
          sendJson(res, 400, { error: (error as Error).message })
          return
        }

        const slots = getDemoSlots({
          centerId,
          serviceId,
          specialistId,
          from,
          to,
          limit
        })

        sendJson(res, 200, slots)
        return
      }

      if (req.method === 'GET' && pathname === '/v1/booking') {
        const filters: BookingListFilters = {}

        const centerId = asQueryString(requestUrl.searchParams.get('center_id'))
        const serviceId = asQueryString(requestUrl.searchParams.get('service_id'))
        const specialistId = asQueryString(requestUrl.searchParams.get('specialist_id'))
        const phone = asQueryString(requestUrl.searchParams.get('phone'))
        const email = asQueryString(requestUrl.searchParams.get('email'))

        if (centerId) filters.centerId = centerId
        if (serviceId) filters.serviceId = serviceId
        if (specialistId) filters.specialistId = specialistId
        if (phone) filters.phone = phone
        if (email) filters.email = email

        const statusParams = requestUrl.searchParams.getAll('status')
        const statuses = statusParams.filter((value): value is BookingStatus =>
          ALLOWED_STATUSES.includes(value as BookingStatus)
        )
        if (statuses.length) {
          filters.status = Array.from(new Set(statuses))
        }

        const bookings = queryDemoBookings(filters)

        sendJson(res, 200, {
          bookings,
          total: bookings.length,
          generatedAt: new Date().toISOString()
        })
        return
      }

      if (req.method === 'POST' && pathname === '/v1/booking') {
        let payload: BookingRequest

        try {
          payload = await readJsonBody<BookingRequest>(req)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : ''
          const isTooLarge = errorMessage === 'Payload слишком большой'
          sendJson(res, isTooLarge ? 413 : 400, {
            error: isTooLarge ? 'Тело запроса слишком большое' : 'Некорректный JSON'
          })
          return
        }

        try {
          validateBookingPayload(payload)
        } catch (error) {
          sendJson(res, 400, { error: (error as Error).message })
          return
        }

        try {
          const booking = createDemoBooking(payload)
          sendJson(res, 201, {
            bookingId: booking.bookingId,
            status: booking.status,
            slotStart: booking.slotStart,
            slotEnd: booking.slotEnd,
            payment: booking.payment,
            funds: booking.funds
          })
          return
        } catch (error) {
          if (error instanceof DemoBookingError) {
            sendJson(res, error.status, { error: error.message, code: error.code })
            return
          }
          throw error
        }
      }

      sendJson(res, 404, { error: 'Не найдено' })
    } catch (error) {
      console.error('[api] Unhandled error', error)
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Внутренняя ошибка сервера' })
      } else {
        res.end()
      }
    }
  }
}

export function createHttpServer() {
  return createServer(createRequestHandler())
}

const isDirectRun = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
})()

if (isDirectRun) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10)
  createHttpServer().listen(port, () => {
    console.log(`[devata-api] listening on port ${port}`)
  })
}
