import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Plugin } from 'vite'

const GVMGEN_ORIGIN = 'http://127.0.0.1:8002'
const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host'])
const GATEWAY_TOKEN = String(process.env.HEARTART_GATEWAY_TOKEN || '').trim()
const GATEWAY_HEADER = 'x-heartart-gateway-token'

function secureEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function authorizeGateway(request: IncomingMessage, response: ServerResponse) {
  if (!GATEWAY_TOKEN) return true
  const supplied = String(request.headers[GATEWAY_HEADER] || '')
  if (secureEqual(supplied, GATEWAY_TOKEN)) return true
  response.statusCode = 401
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify({ detail: 'HeartArt 公网网关认证失败' }))
  return false
}

async function proxyGvmgen(request: IncomingMessage, response: ServerResponse) {
  if (!authorizeGateway(request, response)) return
  try {
    const target = new URL(request.url || '/', GVMGEN_ORIGIN)
    const headers = new Headers()
    Object.entries(request.headers).forEach(([key, value]) => {
      if (!value || HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === GATEWAY_HEADER) return
      if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry))
      else headers.set(key, value)
    })

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      body: hasBody ? request as unknown as BodyInit : undefined,
    }
    if (hasBody) init.duplex = 'half'
    const upstream = await fetch(target, init)
    response.statusCode = upstream.status
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) response.setHeader(key, value)
    })
    if (!upstream.body) {
      response.end()
      return
    }
    Readable.fromWeb(upstream.body as never).pipe(response)
  } catch (error) {
    response.statusCode = 502
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ detail: error instanceof Error ? error.message : 'HeartArt 服务暂时不可用' }))
  }
}

export function gvmgenMiddleware(): Plugin {
  return {
    name: 'heartart-gvmgen-proxy',
    configureServer(server) {
      server.middlewares.use('/gvmgen', proxyGvmgen)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/gvmgen', proxyGvmgen)
    },
  }
}
