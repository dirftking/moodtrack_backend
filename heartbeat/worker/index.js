const API_PREFIXES = ['/ace-step/', '/gvmgen/']
const MAX_VIDEO_UPLOAD_BYTES = 95 * 1024 * 1024
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function isApiRequest(pathname) {
  return API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function apiError(pathname, status, message) {
  if (pathname.startsWith('/ace-step/')) {
    return jsonResponse(status, { data: null, code: status, error: message })
  }
  return jsonResponse(status, { detail: message })
}

function allowedApiRoute(pathname, method) {
  if (pathname === '/ace-step/health') return method === 'GET'
  if (pathname === '/ace-step/release_task') return method === 'POST'
  if (pathname === '/ace-step/query_result') return method === 'POST'
  if (pathname === '/ace-step/v1/audio') return method === 'GET'
  if (pathname === '/gvmgen/health') return method === 'GET'
  if (pathname === '/gvmgen/generate') return method === 'POST'
  if (/^\/gvmgen\/jobs\/[a-f0-9]{32}$/i.test(pathname)) return method === 'GET'
  if (/^\/gvmgen\/files\/[a-f0-9]{32}\/(music\.wav|rendered-video\.mp4)$/i.test(pathname)) return method === 'GET'
  return false
}

async function proxyApiRequest(request, env, url) {
  const origin = String(env.HEARTART_GATEWAY_ORIGIN || '').trim()
  const token = String(env.HEARTART_GATEWAY_TOKEN || '').trim()
  if (!origin || !token) {
    return apiError(url.pathname, 503, 'HeartArt 公网模型服务尚未配置')
  }

  if (!allowedApiRoute(url.pathname, request.method)) {
    return apiError(url.pathname, 404, '不支持的 HeartArt 操作')
  }

  const requestOrigin = request.headers.get('Origin')
  if (requestOrigin && requestOrigin !== url.origin) {
    return apiError(url.pathname, 403, '请求来源无效')
  }

  if (url.pathname === '/gvmgen/generate') {
    const declaredSize = Number(request.headers.get('Content-Length') || 0)
    if (declaredSize > MAX_VIDEO_UPLOAD_BYTES) {
      return apiError(url.pathname, 413, '公网视频暂时支持 95MB 以内的文件')
    }
  }

  let gatewayOrigin
  try {
    gatewayOrigin = new URL(origin)
  } catch {
    return apiError(url.pathname, 503, 'HeartArt 公网模型服务地址无效')
  }

  const target = new URL(`${url.pathname}${url.search}`, gatewayOrigin)
  const headers = new Headers(request.headers)
  headers.delete('Authorization')
  headers.delete('Cookie')
  headers.delete('Host')
  HOP_BY_HOP_HEADERS.forEach((header) => headers.delete(header))
  headers.set('X-HeartArt-Gateway-Token', token)
  headers.set('X-HeartArt-Site-Origin', url.origin)

  const retryable = request.method === 'GET' || url.pathname === '/ace-step/query_result'
  const requestBody = url.pathname === '/ace-step/query_result'
    ? await request.arrayBuffer()
    : request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : request.body
  const attempts = retryable ? 2 : 1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: requestBody,
        redirect: 'manual',
      })
      const responseHeaders = new Headers(upstream.headers)
      responseHeaders.delete('Set-Cookie')
      HOP_BY_HOP_HEADERS.forEach((header) => responseHeaders.delete(header))
      responseHeaders.set('Cache-Control', 'no-store')
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      })
    } catch {
      if (attempt + 1 >= attempts) {
        return apiError(url.pathname, 502, 'HeartArt 本机模型服务暂时离线')
      }
    }
  }

  return apiError(url.pathname, 502, 'HeartArt 本机模型服务暂时离线')
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (isApiRequest(url.pathname)) return proxyApiRequest(request, env, url)

    let response = await env.ASSETS.fetch(request)

    if (response.status === 404 && request.method === 'GET') {
      const accept = request.headers.get('accept') || ''
      if (!url.pathname.includes('.') && accept.includes('text/html')) {
        response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request))
      }
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return response

    const socialImageUrl = new URL('/og.png', request.url).href
    const imageHandler = {
      element(element) {
        element.setAttribute('content', socialImageUrl)
      },
    }

    return new HTMLRewriter()
      .on('meta[property="og:image"]', imageHandler)
      .on('meta[name="twitter:image"]', imageHandler)
      .transform(response)
  },
}

export default worker
