import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { copyFile, realpath, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

const ACE_STEP_ORIGIN = 'http://127.0.0.1:8001'
const ACE_STEP_AUDIO_ROOT = resolve(process.cwd(), '..', 'frontend', 'services', 'ACE-Step-1.5', '.cache', 'acestep', 'tmp', 'api_audio')
const MAX_BODY_BYTES = 64 * 1024
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
  sendError(response, 401, 'HeartArt 公网网关认证失败')
  return false
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback
}

function sendError(response: ServerResponse, status: number, message: string) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify({ data: null, code: status, error: message }))
}

function readJson(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('REQUEST_TOO_LARGE'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        reject(new Error('INVALID_JSON'))
      }
    })
    request.on('error', reject)
  })
}

async function stagedSourceAudioPath(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('局部修改需要选择一个已生成的源音频')

  let audioPath = raw
  try {
    const url = new URL(raw, 'http://heartart.local')
    if (url.pathname === '/v1/audio') audioPath = url.searchParams.get('path') || ''
  } catch {
    throw new Error('源音频地址无效')
  }

  const safeAudioPath = /[\\/]api_audio[\\/][^\\/]+\.(wav|wav32|mp3|flac|opus|aac)$/i.test(audioPath)
    && !audioPath.includes('..')
  if (!safeAudioPath) throw new Error('源音频地址无效')

  const [resolvedAudioPath, resolvedAudioRoot] = await Promise.all([
    realpath(audioPath),
    realpath(ACE_STEP_AUDIO_ROOT),
  ])
  if (!resolvedAudioPath.startsWith(`${resolvedAudioRoot}${sep}`)) throw new Error('源音频地址无效')

  const stagedPath = join(tmpdir(), `heartart-repaint-${randomUUID()}${extname(resolvedAudioPath) || '.wav'}`)
  await copyFile(resolvedAudioPath, stagedPath)
  const cleanupTimer = setTimeout(() => {
    void unlink(stagedPath).catch(() => undefined)
  }, 60 * 60 * 1_000)
  cleanupTimer.unref()
  return stagedPath
}

async function sanitizeGeneration(body: Record<string, unknown>) {
  const prompt = String(body.prompt || '').trim().slice(0, 4_000)
  if (!prompt) throw new Error('音乐描述不能为空')
  const requestedLyrics = String(body.lyrics || '')
  const structuredInstrumental = /^(\s*\[[^\]\r\n]{1,120}\]\s*)+$/u.test(requestedLyrics)
  const taskType = body.task_type === 'repaint' ? 'repaint' : 'text2music'
  const audioDuration = Math.round(clamp(body.audio_duration, 10, 180, 60))

  const generation = {
    task_type: taskType,
    prompt,
    lyrics: structuredInstrumental ? requestedLyrics.slice(0, 1_200) : '[Instrumental]',
    instrumental: true,
    vocal_language: 'unknown',
    thinking: false,
    model: 'acestep-v15-turbo',
    audio_format: 'wav',
    bpm: Math.round(clamp(body.bpm, 30, 300, 100)),
    key_scale: String(body.key_scale || '').slice(0, 32),
    time_signature: '4',
    audio_duration: audioDuration,
    inference_steps: 8,
    batch_size: 1,
    use_random_seed: true,
  }

  if (taskType === 'repaint') {
    const repaintingStart = clamp(body.repainting_start, 0, Math.max(0, audioDuration - 0.5), 0)
    const repaintingEnd = clamp(body.repainting_end, repaintingStart + 0.5, audioDuration, audioDuration)
    return {
      ...generation,
      src_audio_path: await stagedSourceAudioPath(body.source_file),
      repainting_start: repaintingStart,
      repainting_end: repaintingEnd,
      repaint_mode: 'balanced',
      repaint_strength: clamp(body.repaint_strength, 0.05, 1, 0.65),
      repaint_latent_crossfade_frames: Math.round(clamp(body.repaint_latent_crossfade_frames, 0, 50, 12)),
      repaint_wav_crossfade_sec: clamp(body.repaint_wav_crossfade_sec, 0, 2, 0.2),
    }
  }

  return generation
}

function sanitizeQuery(body: Record<string, unknown>) {
  const ids = Array.isArray(body.task_id_list) ? body.task_id_list : []
  const taskId = String(ids[0] || '')
  if (!/^[a-f0-9-]{32,40}$/i.test(taskId)) throw new Error('任务编号无效')
  return { task_id_list: [taskId] }
}

async function forward(
  response: ServerResponse,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
) {
  const upstream = await fetch(`${ACE_STEP_ORIGIN}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
  const upstreamBytes = Buffer.from(await upstream.arrayBuffer())
  const bytes = contentType.includes('application/json')
    ? Buffer.from(
        upstreamBytes
          .toString('utf8')
          .replace(/ACE[\s-]*Step(?:\s*1\.5)?/gi, 'HeartArt')
          .replace(/acestep/gi, 'HeartArt')
          .replace(/GVM\s*Gen/gi, 'HeartArt'),
        'utf8',
      )
    : upstreamBytes

  response.statusCode = upstream.status
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Length', String(bytes.length))
  response.setHeader('Cache-Control', 'no-store')
  response.end(bytes)
}

async function handleAceStepRequest(request: IncomingMessage, response: ServerResponse) {
  if (!authorizeGateway(request, response)) return
  try {
    const url = new URL(request.url || '/', ACE_STEP_ORIGIN)

    if (request.method === 'GET' && url.pathname === '/health') {
      await forward(response, '/health', 'GET')
      return
    }

    if (request.method === 'POST' && url.pathname === '/release_task') {
      const body = await sanitizeGeneration(await readJson(request))
      await forward(response, '/release_task', 'POST', body)
      return
    }

    if (request.method === 'POST' && url.pathname === '/query_result') {
      const body = sanitizeQuery(await readJson(request))
      await forward(response, '/query_result', 'POST', body)
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1/audio') {
      const audioPath = url.searchParams.get('path') || ''
      const safeAudioPath = /[\\/]api_audio[\\/][^\\/]+\.(wav|wav32|mp3|flac|opus|aac)$/i.test(audioPath)
        && !audioPath.includes('..')
      if (!safeAudioPath) {
        sendError(response, 400, '音频地址无效')
        return
      }
      await forward(response, `${url.pathname}${url.search}`, 'GET')
      return
    }

    sendError(response, 404, '不支持的 HeartArt 音乐操作')
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
      sendError(response, 413, '请求内容过大')
    } else if (error instanceof Error && error.message === 'INVALID_JSON') {
      sendError(response, 400, '请求格式无效')
    } else {
      sendError(response, 502, error instanceof Error ? error.message : 'HeartArt 音乐服务暂时不可用')
    }
  }
}

export function aceStepMiddleware(): Plugin {
  return {
    name: 'heartart-ace-step-proxy',
    configureServer(server) {
      server.middlewares.use('/ace-step', handleAceStepRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/ace-step', handleAceStepRequest)
    },
  }
}
