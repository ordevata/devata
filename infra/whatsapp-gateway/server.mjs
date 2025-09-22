import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'

const config = {
  port: Number.parseInt(process.env.PORT ?? '8080', 10) || 8080,
  outboundToken: process.env.OUTBOUND_TOKEN ?? '',
  inboundWebhookUrl: process.env.INBOUND_WEBHOOK_URL ?? '',
  inboundWebhookSecret: process.env.INBOUND_WEBHOOK_SECRET ?? '',
  simulationToken: process.env.SIMULATION_TOKEN ?? '',
  rateLimitPerMinute: Math.max(Number.parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? '20', 10) || 20, 1)
}

const rateTracker = new Map()
const MAX_BODY_SIZE = 256 * 1024

function respondJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*'
  })
  res.end(body)
}

function parseBearer(headerValue) {
  if (!headerValue) return ''
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : headerValue
}

function secureEquals(expected, provided) {
  if (!expected) return true
  if (!provided) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  if (expectedBuffer.length !== providedBuffer.length) {
    return false
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer)
}

function validateMetadata(metadata) {
  if (metadata === undefined) return true
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  return Object.values(metadata).every((value) => typeof value === 'string')
}

function validateOutbound(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Требуется JSON-объект'
  }

  const { to, message, metadata } = payload

  if (typeof to !== 'string' || to.trim().length < 5) {
    return 'Поле "to" должно быть строкой с номером получателя'
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    return 'Поле "message" обязательно'
  }

  if (message.length > 4096) {
    return 'Сообщение превышает допустимую длину (4096 символов)'
  }

  if (!validateMetadata(metadata)) {
    return 'Поле "metadata" должно быть объектом со строковыми значениями'
  }

  return null
}

function validateInbound(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Требуется JSON-объект'
  }

  const { from, message } = payload

  if (typeof from !== 'string' || from.trim().length < 5) {
    return 'Поле "from" должно быть строкой'
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    return 'Поле "message" обязательно'
  }

  if (message.length > 4096) {
    return 'Сообщение превышает допустимую длину (4096 символов)'
  }

  return null
}

function checkRateLimit(identifier) {
  const now = Date.now()
  const windowStart = Math.floor(now / 60000) * 60000
  const current = rateTracker.get(identifier)

  if (!current || current.windowStart !== windowStart) {
    rateTracker.set(identifier, { windowStart, count: 1 })
    return { allowed: true }
  }

  if (current.count >= config.rateLimitPerMinute) {
    const retryAfterMs = windowStart + 60000 - now
    return { allowed: false, retryAfterMs }
  }

  current.count += 1
  return { allowed: true }
}

async function readBody(req) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_SIZE) {
      throw new Error('Payload too large')
    }
    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return ''
  }

  return Buffer.concat(chunks).toString('utf8')
}

function buildHmac(payload) {
  if (!config.inboundWebhookSecret) {
    return ''
  }
  return crypto.createHmac('sha256', config.inboundWebhookSecret).update(payload).digest('hex')
}

async function forwardToN8N(message) {
  if (!config.inboundWebhookUrl) {
    console.warn('[WA][INBOUND] INBOUND_WEBHOOK_URL не задан, событие пропущено')
    return false
  }

  const body = JSON.stringify(message)
  const headers = {
    'content-type': 'application/json',
    'x-signature': buildHmac(body)
  }

  try {
    const response = await fetch(config.inboundWebhookUrl, {
      method: 'POST',
      headers,
      body
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('[WA][INBOUND] Ошибка ответа n8n', response.status, text)
      return false
    }

    console.log('[WA][INBOUND] Событие передано в n8n от', message.from)
    return true
  } catch (error) {
    console.error('[WA][INBOUND] Не удалось отправить событие в n8n', error)
    return false
  }
}

async function handleSend(req, res) {
  if (!secureEquals(config.outboundToken, parseBearer(req.headers.authorization))) {
    respondJson(res, 401, { error: 'Требуется авторизация' })
    return
  }

  let payload

  try {
    const raw = await readBody(req)
    payload = raw ? JSON.parse(raw) : null
  } catch (error) {
    respondJson(res, 400, { error: 'Некорректный JSON' })
    return
  }

  const validationError = validateOutbound(payload)
  if (validationError) {
    respondJson(res, 400, { error: validationError })
    return
  }

  const { to, metadata } = payload
  const rate = checkRateLimit(to)
  if (!rate.allowed) {
    respondJson(res, 429, { error: 'Превышен лимит сообщений', retryAfterMs: rate.retryAfterMs })
    return
  }

  const jobId = crypto.randomUUID()
  console.log('[WA][OUTBOUND] Добавлено сообщение', { jobId, to, metadata })

  respondJson(res, 202, { jobId, status: 'queued' })
}

async function handleSimulate(req, res) {
  if (config.simulationToken && req.headers['x-simulation-token'] !== config.simulationToken) {
    respondJson(res, 403, { error: 'Недостаточно прав' })
    return
  }

  let payload
  try {
    const raw = await readBody(req)
    payload = raw ? JSON.parse(raw) : null
  } catch (error) {
    respondJson(res, 400, { error: 'Некорректный JSON' })
    return
  }

  const validationError = validateInbound(payload)
  if (validationError) {
    respondJson(res, 400, { error: validationError })
    return
  }

  const message = {
    from: payload.from,
    message: payload.message,
    receivedAt: typeof payload.receivedAt === 'string' ? payload.receivedAt : new Date().toISOString(),
    raw: typeof payload.raw === 'object' && payload.raw !== null ? payload.raw : undefined
  }

  console.log('[WA][SIMULATION] Получено входящее сообщение', { from: message.from })
  const forwarded = await forwardToN8N(message)
  respondJson(res, 202, { forwarded })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/healthz') {
    respondJson(res, 200, { ok: true, uptime: process.uptime() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    await handleSend(req, res)
    return
  }

  if (req.method === 'POST' && url.pathname === '/simulate/inbound') {
    await handleSimulate(req, res)
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-simulation-token'
    })
    res.end()
    return
  }

  respondJson(res, 404, { error: 'Маршрут не найден' })
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[WA][START] Шлюз запущен на порту ${config.port}`)
  if (!config.outboundToken) {
    console.warn('[WA][WARN] OUTBOUND_TOKEN не задан — /send открыт без авторизации')
  }
})

process.on('SIGINT', () => {
  console.log('[WA][STOP] Получен SIGINT, завершаем работу')
  server.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  console.log('[WA][STOP] Получен SIGTERM, завершаем работу')
  server.close(() => process.exit(0))
})
