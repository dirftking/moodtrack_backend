import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { copyFile, realpath, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

const ACE_STEP_ORIGIN = 'http://127.0.0.1:8001'
const ACE_STEP_AUDIO_ROOT = resolve(process.cwd(), 'services', 'ACE-Step-1.5', '.cache', 'acestep', 'tmp', 'api_audio')
const MAX_BODY_BYTES = 64 * 1024

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
    const url = new URL(raw, 'http://moodtrack.local')
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

  const stagedPath = join(tmpdir(), `moodtrack-repaint-${randomUUID()}${extname(resolvedAudioPath) || '.wav'}`)
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
  const requestedLyrics = String(body.lyrics || '').trim()
  const instrumental = body.instrumental !== false
  const structuredInstrumental = /^(\s*\[[^\]\r\n]{1,120}\]\s*)+$/u.test(requestedLyrics)
  if (!instrumental && !requestedLyrics) throw new Error('人声歌曲模式需要填写歌词')
  const vocalLanguage = String(body.vocal_language || 'zh').toLowerCase()
  const supportedLanguage = /^(zh|en|ja|ko|unknown)$/.test(vocalLanguage) ? vocalLanguage : 'zh'
  const taskType = body.task_type === 'repaint' ? 'repaint' : 'text2music'
  const audioDuration = Math.round(clamp(body.audio_duration, 10, 180, 60))

  const generation = {
    task_type: taskType,
    prompt,
    lyrics: instrumental
      ? (structuredInstrumental ? requestedLyrics.slice(0, 1_200) : '[Instrumental]')
      : requestedLyrics.slice(0, 6_000),
    vocal_language: instrumental ? 'unknown' : supportedLanguage,
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

function sanitizeLyricSample(body: Record<string, unknown>) {
  const query = String(body.query || '').trim().slice(0, 4_000)
  if (!query) throw new Error('歌词创作描述不能为空')
  const vocalLanguage = String(body.vocal_language || 'zh').toLowerCase()
  const supportedLanguage = /^(zh|en|ja|ko|unknown)$/.test(vocalLanguage) ? vocalLanguage : 'zh'
  return {
    query,
    instrumental: false,
    vocal_language: supportedLanguage,
    temperature: clamp(body.temperature, 0.7, 1.2, 1.02),
  }
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
  const bytes = Buffer.from(await upstream.arrayBuffer())

  response.statusCode = upstream.status
  response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')
  response.setHeader('Content-Length', String(bytes.length))
  response.setHeader('Cache-Control', 'no-store')
  response.end(bytes)
}

export function aceStepMiddleware(): Plugin {
  return {
    name: 'moodtrack-ace-step-proxy',
    configureServer(server) {
      server.middlewares.use('/ace-step', async (request, response) => {
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

          if (request.method === 'POST' && url.pathname === '/v1/create_sample') {
            const body = sanitizeLyricSample(await readJson(request))
            await forward(response, '/v1/create_sample', 'POST', body)
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

          sendError(response, 404, '不支持的 ACE-Step 操作')
        } catch (error) {
          if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
            sendError(response, 413, '请求内容过大')
          } else if (error instanceof Error && error.message === 'INVALID_JSON') {
            sendError(response, 400, '请求格式无效')
          } else {
            sendError(response, 502, error instanceof Error ? error.message : 'ACE-Step 服务暂时不可用')
          }
        }
      })
    },
  }
}
