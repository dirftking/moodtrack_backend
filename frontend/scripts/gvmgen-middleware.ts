import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const GVMGEN_ORIGIN = 'http://127.0.0.1:8002'
const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host'])
const MAX_PROXY_UPLOAD_BYTES = 100 * 1024 * 1024
const MAX_CHUNK_BYTES = 1024 * 1024
const MAX_UPLOAD_INIT_BYTES = 16 * 1024
const MAX_UPLOAD_COMPLETE_BYTES = 1024
const GENERATION_WINDOW_MS = 30 * 60 * 1_000
const MAX_GENERATIONS_PER_WINDOW = 3
const MAX_UPLOAD_SESSIONS_PER_WINDOW = 10
const generationHistory = new Map<string, number[]>()
const uploadHistory = new Map<string, number[]>()

function sendJson(response: ServerResponse, status: number, detail: string, extraHeaders?: Record<string, string>) {
  const bytes = Buffer.from(JSON.stringify({ detail }))
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', String(bytes.length))
  response.setHeader('Cache-Control', 'no-store, max-age=0')
  response.setHeader('Pragma', 'no-cache')
  response.setHeader('Expires', '0')
  Object.entries(extraHeaders || {}).forEach(([key, value]) => response.setHeader(key, value))
  response.end(bytes)
}

function requestIp(request: IncomingMessage) {
  const cloudflare = String(request.headers['cf-connecting-ip'] || '').trim()
  if (cloudflare) return cloudflare
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || request.socket.remoteAddress || 'unknown'
}

function routeAllowed(method: string | undefined, pathname: string) {
  if (method === 'GET' && pathname === '/health') return true
  if (method === 'POST' && pathname === '/generate') return true
  if (method === 'POST' && pathname === '/uploads') return true
  if (method === 'POST' && pathname === '/object-uploads') return true
  if (method === 'GET' && /^\/uploads\/[a-f0-9]{32}$/i.test(pathname)) return true
  if (method === 'GET' && /^\/object-uploads\/[a-f0-9]{32}$/i.test(pathname)) return true
  if (method === 'PUT' && /^\/uploads\/[a-f0-9]{32}\/chunks\/\d+$/i.test(pathname)) return true
  if (method === 'POST' && /^\/uploads\/[a-f0-9]{32}\/complete$/i.test(pathname)) return true
  if (method === 'POST' && /^\/object-uploads\/[a-f0-9]{32}\/complete$/i.test(pathname)) return true
  if (method === 'GET' && /^\/jobs\/[a-f0-9]{32}$/i.test(pathname)) return true
  return method === 'GET' && /^\/files\/[a-f0-9]{32}\/(music\.wav|rendered-video\.mp4)$/i.test(pathname)
}

function reserveRequest(history: Map<string, number[]>, ip: string, limit: number) {
  const now = Date.now()
  history.forEach((timestamps, key) => {
    if (!timestamps.some((timestamp) => now - timestamp < GENERATION_WINDOW_MS)) history.delete(key)
  })
  const recent = (history.get(ip) || []).filter((timestamp) => now - timestamp < GENERATION_WINDOW_MS)
  if (recent.length >= limit) {
    history.set(ip, recent)
    return false
  }
  recent.push(now)
  history.set(ip, recent)
  return true
}

function proxyGvmgen(request: IncomingMessage, response: ServerResponse) {
  try {
    const incoming = new URL(request.url || '/', 'http://moodtrack.local')
    if (!routeAllowed(request.method, incoming.pathname)) {
      request.resume()
      sendJson(response, 404, '接口不存在')
      return
    }

    if (request.method === 'POST' && incoming.pathname === '/generate') {
      const contentLength = Number(request.headers['content-length'] || 0)
      if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_UPLOAD_BYTES) {
        request.resume()
        sendJson(response, 413, '视频不能超过 100MB')
        return
      }
      if (!reserveRequest(generationHistory, requestIp(request), MAX_GENERATIONS_PER_WINDOW)) {
        request.resume()
        sendJson(response, 429, '生成请求过于频繁，请稍后再试', { 'Retry-After': String(GENERATION_WINDOW_MS / 1_000) })
        return
      }
    }

    if (request.method === 'POST' && ['/uploads', '/object-uploads'].includes(incoming.pathname)) {
      const contentLength = Number(request.headers['content-length'] || 0)
      if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_INIT_BYTES) {
        request.resume()
        sendJson(response, 413, '上传初始化参数过大')
        return
      }
      if (!reserveRequest(uploadHistory, requestIp(request), MAX_UPLOAD_SESSIONS_PER_WINDOW)) {
        request.resume()
        sendJson(response, 429, '视频上传请求过于频繁，请稍后再试', { 'Retry-After': String(GENERATION_WINDOW_MS / 1_000) })
        return
      }
    }

    if (request.method === 'POST' && /\/complete$/i.test(incoming.pathname)) {
      const contentLength = Number(request.headers['content-length'] || 0)
      if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_UPLOAD_COMPLETE_BYTES) {
        request.resume()
        sendJson(response, 413, '视频提交参数过大')
        return
      }
    }

    if (request.method === 'PUT' && /\/chunks\/\d+$/i.test(incoming.pathname)) {
      const contentLength = Number(request.headers['content-length'] || 0)
      if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_CHUNK_BYTES) {
        request.resume()
        sendJson(response, 413, '视频分片不能超过 1MB')
        return
      }
    }

    const target = new URL(`${incoming.pathname}${incoming.search}`, GVMGEN_ORIGIN)
    const headers: Record<string, string | string[]> = {}
    Object.entries(request.headers).forEach(([key, value]) => {
      if (!value || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return
      headers[key] = value
    })

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const upstreamRequest = httpRequest(target, {
      method: request.method,
      headers,
    }, (upstream) => {
      response.statusCode = upstream.statusCode || 502
      if (upstream.statusMessage) response.statusMessage = upstream.statusMessage
      Object.entries(upstream.headers).forEach(([key, value]) => {
        if (value !== undefined && !HOP_BY_HOP_HEADERS.has(key.toLowerCase())) response.setHeader(key, value)
      })
      response.setHeader('Cache-Control', 'no-store, max-age=0')
      response.setHeader('Pragma', 'no-cache')
      response.setHeader('Expires', '0')
      upstream.on('error', (error) => {
        if (!response.headersSent) sendJson(response, 502, error.message)
        else response.destroy(error)
      })
      upstream.pipe(response)
    })
    upstreamRequest.on('error', (error) => {
      if (!response.headersSent) sendJson(response, 502, error.message)
      else response.destroy(error)
    })
    request.on('aborted', () => upstreamRequest.destroy())
    if (hasBody) request.pipe(upstreamRequest)
    else upstreamRequest.end()
  } catch (error) {
    sendJson(response, 502, error instanceof Error ? error.message : 'MoodTrack 服务暂时不可用')
  }
}

export function gvmgenMiddleware(): Plugin {
  return {
    name: 'moodtrack-gvmgen-proxy',
    configureServer(server) {
      server.middlewares.use('/gvmgen', proxyGvmgen)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/gvmgen', proxyGvmgen)
    },
  }
}
