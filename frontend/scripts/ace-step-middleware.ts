import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'
import {
  analyzeEmotionContext,
  emotionLabel,
  isEmotionId,
  type EmotionAnalysis,
  type EmotionContextInput,
  type EmotionId,
} from '../shared/emotions'

const DEFAULT_API_URL = 'https://api.acemusic.ai'
const DEFAULT_MODEL = 'acemusic/acestep-v15-turbo'
const MAX_BODY_BYTES = 256 * 1024
const MAX_AUDIO_BYTES = 96 * 1024 * 1024
const MAX_AUDIO_CACHE_BYTES = 256 * 1024 * 1024
const MAX_REFERENCE_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_ACTIVE_TASKS = 2
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000
const MAX_TASKS_PER_WINDOW = 6
const TASK_RETENTION_MS = 2 * 60 * 60 * 1_000
const CLOUD_REQUEST_TIMEOUT_MS = 9 * 60 * 1_000
const HEALTH_CACHE_MS = 5 * 60 * 1_000

type AceStepCloudOptions = {
  apiUrl?: string
  apiKey?: string
  model?: string
  referenceRoot?: string
}

type TaskStatus = 0 | 1 | 2

type CloudTask = {
  id: string
  status: TaskStatus
  result?: string
  error?: string
  createdAt: number
  updatedAt: number
}

type StoredAudio = {
  bytes: Buffer
  contentType: string
  format: string
  createdAt: number
}

type SanitizedGeneration = {
  taskType: 'text2music' | 'repaint'
  prompt: string
  lyrics: string
  sampleMode: boolean
  sampleQuery: string
  instrumental: boolean
  vocalLanguage: string
  bpm: number
  keyScale: string
  timeSignature: string
  duration: number
  sourceKey?: string
  repaintingStart?: number
  repaintingEnd?: number
  repaintStrength?: number
  emotionAnalysis?: EmotionAnalysis
  referenceEmotionId?: EmotionId
}

type ReferenceClipManifest = {
  id: string
  emotionId: EmotionId
  file: string
  format: string
  duration?: number
  license?: string
  source?: string
}

type LoadedReference = {
  id: string
  emotionId: EmotionId
  labelZh: string
  labelEn: string
  format: string
  bytes: Buffer
  modifiedAt: number
}

type CompletionAudio = {
  audio_url?: { url?: string }
  url?: string
}

type CompletionPayload = {
  id?: string
  model?: string
  detail?: string
  error?: string | { message?: string }
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string | null
      audio?: CompletionAudio[] | null
      audio_codes?: string | null
    }
  }>
  audio?: CompletionAudio[]
}

class CloudApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const bytes = Buffer.from(JSON.stringify(payload))
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', String(bytes.length))
  response.setHeader('Cache-Control', 'no-store')
  response.end(bytes)
}

function sendEnvelope(response: ServerResponse, data: unknown, status = 200) {
  sendJson(response, status, {
    data,
    code: status,
    error: null,
    timestamp: Date.now(),
    extra: null,
  })
}

function sendError(response: ServerResponse, status: number, message: string) {
  sendJson(response, status, {
    data: null,
    code: status,
    error: message,
    timestamp: Date.now(),
    extra: null,
  })
}

function readJson(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false

    request.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        reject(new Error('REQUEST_TOO_LARGE'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        reject(new Error('INVALID_JSON'))
      }
    })
    request.on('error', reject)
  })
}

function parseSourceKey(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('局部修改需要选择一段已经生成的源音频')

  let key = ''
  try {
    const url = new URL(raw, 'http://moodtrack.local')
    if (url.pathname !== '/v1/audio') throw new Error('INVALID_SOURCE')
    key = url.searchParams.get('path') || ''
  } catch {
    throw new Error('源音频地址无效或已经过期')
  }

  if (!/^cloud\/[a-f0-9-]+\.(mp3|wav|flac|ogg|aac|m4a)$/i.test(key)) {
    throw new Error('源音频地址无效或已经过期')
  }
  return key
}

function sanitizeEmotionContext(value: unknown, fallbackDuration = 60): EmotionContextInput {
  const context = asRecord(value)
  const duration = Math.round(clamp(context.duration, 10, 180, fallbackDuration))
  const rawMoods = Array.isArray(context.moods) ? context.moods.slice(0, 12) : []
  const moods = rawMoods.map((item) => {
    const mood = asRecord(item)
    return {
      label: String(mood.label || '').trim().slice(0, 160),
      time: clamp(mood.time, 0, duration, 0),
      intensity: clamp(mood.intensity, 0, 100, 50),
    }
  })

  return {
    title: String(context.title || '').trim().slice(0, 240),
    scene: String(context.scene || '').trim().slice(0, 360),
    style: String(context.style || '').trim().slice(0, 800),
    description: String(context.description || '').trim().slice(0, 1_000),
    duration,
    moods,
  }
}

function sanitizeGeneration(body: Record<string, unknown>): SanitizedGeneration {
  const prompt = String(body.prompt || '').trim().slice(0, 4_000)
  if (!prompt) throw new Error('音乐描述不能为空')

  const taskType = body.task_type === 'repaint' ? 'repaint' : 'text2music'
  if (typeof body.instrumental !== 'boolean') throw new Error('纯音乐模式参数必须是布尔值')
  const instrumental = body.instrumental
  const sampleMode = taskType === 'text2music' && !instrumental && body.sample_mode === true
  const sampleQuery = String(body.sample_query || '').trim().slice(0, 6_000)
  const requestedLyrics = String(body.lyrics || '').trim()
  const structuredInstrumental = /^(\s*\[[^\]\r\n]{1,120}\]\s*)+$/u.test(requestedLyrics)
  if (sampleMode && !sampleQuery) throw new Error('自动作词描述不能为空')
  if (!instrumental && !sampleMode && !requestedLyrics) throw new Error('人声歌曲模式需要填写歌词')

  const vocalLanguage = String(body.vocal_language || 'zh').toLowerCase()
  const supportedLanguage = /^(zh|en|ja|ko|unknown)$/.test(vocalLanguage) ? vocalLanguage : 'zh'
  const duration = Math.round(clamp(body.audio_duration, 10, 180, 60))

  const generation: SanitizedGeneration = {
    taskType,
    prompt,
    lyrics: instrumental
      ? (structuredInstrumental ? requestedLyrics.slice(0, 1_200) : '[Instrumental]')
      : requestedLyrics.slice(0, 6_000),
    sampleMode,
    sampleQuery,
    instrumental,
    vocalLanguage: instrumental ? 'unknown' : supportedLanguage,
    bpm: body.bpm === 0 ? 0 : Math.round(clamp(body.bpm, 30, 300, 100)),
    keyScale: String(body.key_scale || '').slice(0, 32),
    timeSignature: '4',
    duration,
  }

  if (taskType === 'repaint') {
    const repaintingStart = clamp(body.repainting_start, 0, Math.max(0, duration - 0.5), 0)
    const repaintingEnd = clamp(body.repainting_end, repaintingStart + 0.5, duration, duration)
    generation.sourceKey = parseSourceKey(body.source_file)
    generation.repaintingStart = repaintingStart
    generation.repaintingEnd = repaintingEnd
    generation.repaintStrength = clamp(body.repaint_strength, 0.05, 1, 0.65)
  } else {
    generation.emotionAnalysis = {
      ...analyzeEmotionContext(sanitizeEmotionContext(body.emotion_context, duration)),
      referenceEmotionId: null,
    }
  }

  return generation
}

function sanitizeQuery(body: Record<string, unknown>) {
  const ids = Array.isArray(body.task_id_list) ? body.task_id_list : []
  const taskId = String(ids[0] || '')
  if (!/^[a-f0-9-]{36}$/i.test(taskId)) throw new Error('任务编号无效')
  return taskId
}

function cloudErrorMessage(payload: unknown, status: number) {
  const record = asRecord(payload)
  if (typeof record.detail === 'string' && record.detail.trim()) return record.detail
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  const nestedError = asRecord(record.error)
  if (typeof nestedError.message === 'string' && nestedError.message.trim()) return nestedError.message
  return `ACE 云端请求失败（HTTP ${status}）`
}

function completionMessage(payload: CompletionPayload) {
  return payload.choices?.[0]?.message
}

function completionContent(payload: CompletionPayload) {
  return completionMessage(payload)?.content || ''
}

function parseCompletionMetadata(content: string) {
  const caption = content.match(/\*\*Caption:\*\*\s*([^\r\n]+)/i)?.[1]?.trim() || ''
  const lyrics = content.match(/##\s*Lyrics\s*\r?\n([\s\S]+)$/i)?.[1]?.trim() || ''
  const bpm = Number(content.match(/\*\*BPM:\*\*\s*(\d+)/i)?.[1] || '')
  const duration = Number(content.match(/\*\*Duration:\*\*\s*([\d.]+)/i)?.[1] || '')
  const keyScale = content.match(/\*\*Key:\*\*\s*([^\r\n]+)/i)?.[1]?.trim() || ''
  return { caption, lyrics, bpm, duration, keyScale }
}

function hasAudioSignature(bytes: Buffer, format: string) {
  if (format === 'wav') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
  }
  if (format === 'flac') return bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'fLaC'
  if (format === 'ogg') return bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS'
  if (format === 'm4a') return bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp'
  if (format === 'aac') return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0
  if (format === 'mp3') {
    return bytes.length >= 3 && (
      bytes.subarray(0, 3).toString('ascii') === 'ID3'
      || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    )
  }
  return false
}

function mimeDetails(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('ACE 云端返回了无效的音频数据')
  const header = dataUrl.slice(0, comma)
  const base64 = dataUrl.slice(comma + 1).replace(/\s+/g, '')
  const match = header.match(/^data:(audio\/[a-z0-9.+-]+);base64$/i)
  if (!match || !base64 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) {
    throw new Error('ACE 云端返回了无效的音频数据')
  }

  const contentType = match[1].toLowerCase()
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length) throw new Error('ACE 云端返回了空音频')
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error('ACE 云端返回的音频超过了 MoodTrack 的安全上限')

  const formats: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
  }
  const format = formats[contentType]
  if (!format || !hasAudioSignature(bytes, format)) {
    throw new Error('ACE 云端返回的音频格式无效或与 MIME 类型不一致')
  }
  return { bytes, contentType, format }
}

export function aceStepMiddleware(options: AceStepCloudOptions = {}): Plugin {
  const apiUrl = (options.apiUrl || DEFAULT_API_URL).trim().replace(/\/+$/, '')
  const apiKey = (options.apiKey || '').trim()
  const model = (options.model || DEFAULT_MODEL).trim()
  const tasks = new Map<string, CloudTask>()
  const audioCache = new Map<string, StoredAudio>()
  const requestHistory = new Map<string, number[]>()
  let referenceRoot = options.referenceRoot
    ? resolve(options.referenceRoot)
    : resolve(process.cwd(), 'emotion-reference-library')
  const referenceCache = new Map<string, LoadedReference>()
  let manifestCache: ReferenceClipManifest[] | null = null
  let healthCache = { checkedAt: 0, ok: false, message: '尚未检查 ACE 云端状态' }
  let generationFailure = { until: 0, message: '' }

  async function loadReferenceManifest() {
    if (manifestCache) return manifestCache
    const raw = JSON.parse(await readFile(resolve(referenceRoot, 'manifest.json'), 'utf8')) as unknown
    const record = asRecord(raw)
    const clips = Array.isArray(record.clips) ? record.clips : []
    manifestCache = clips.flatMap((item) => {
      const clip = asRecord(item)
      const id = String(clip.id || '').trim()
      const file = String(clip.file || '').trim().replace(/\\/g, '/')
      const format = String(clip.format || '').trim().toLowerCase()
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/i.test(id) || !isEmotionId(clip.emotionId)) return []
      if (!/^[a-z0-9/_-]+\.(wav|mp3|flac|ogg|aac|m4a)$/i.test(file)) return []
      if (!/^(wav|mp3|flac|ogg|aac|m4a)$/.test(format)) return []
      return [{
        id,
        emotionId: clip.emotionId,
        file,
        format,
        duration: Number(clip.duration) || undefined,
        license: String(clip.license || '').slice(0, 80),
        source: String(clip.source || '').slice(0, 160),
      } satisfies ReferenceClipManifest]
    })
    return manifestCache
  }

  async function loadEmotionReference(emotionId: EmotionId | undefined) {
    if (!emotionId) return undefined
    try {
      const clips = (await loadReferenceManifest()).filter((clip) => clip.emotionId === emotionId)
      const clip = clips[0]
      if (!clip) return undefined

      const requestedPath = resolve(referenceRoot, clip.file)
      const canonicalRoot = await realpath(referenceRoot)
      const canonicalPath = await realpath(requestedPath)
      const relativePath = relative(canonicalRoot, canonicalPath)
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return undefined
      const fileStats = await stat(canonicalPath)
      const cached = referenceCache.get(clip.id)
      if (cached?.modifiedAt === fileStats.mtimeMs) return cached
      const bytes = await readFile(canonicalPath)
      if (!bytes.length || bytes.length > MAX_REFERENCE_AUDIO_BYTES) return undefined
      if (clip.format === 'wav' && (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WAVE')) {
        return undefined
      }
      const labels = emotionLabel(emotionId)
      const loaded: LoadedReference = {
        id: clip.id,
        emotionId,
        labelZh: labels.labelZh,
        labelEn: labels.labelEn,
        format: clip.format,
        bytes,
        modifiedAt: fileStats.mtimeMs,
      }
      referenceCache.set(clip.id, loaded)
      return loaded
    } catch {
      return undefined
    }
  }

  function publicReference(reference: LoadedReference | undefined) {
    return reference ? {
      id: reference.id,
      emotionId: reference.emotionId,
      labelZh: reference.labelZh,
      labelEn: reference.labelEn,
      available: true,
    } : null
  }

  async function referenceCategoryCount() {
    try {
      return new Set((await loadReferenceManifest()).map((clip) => clip.emotionId)).size
    } catch {
      return 0
    }
  }

  function isReferenceCompatibilityError(error: unknown) {
    return error instanceof CloudApiError
      && [400, 422].includes(error.status)
      && /(reference|input[_ -]?audio|audio input|base64|multimodal|audio format)/i.test(error.message)
  }

  function headers() {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'MoodTrack/1.0',
    }
  }

  function pruneExpired() {
    const cutoff = Date.now() - TASK_RETENTION_MS
    for (const [id, task] of tasks) {
      if (task.updatedAt < cutoff) tasks.delete(id)
    }
    for (const [key, audio] of audioCache) {
      if (audio.createdAt < cutoff) audioCache.delete(key)
    }
    for (const [client, timestamps] of requestHistory) {
      const recent = timestamps.filter((timestamp) => timestamp >= Date.now() - RATE_LIMIT_WINDOW_MS)
      if (recent.length) requestHistory.set(client, recent)
      else requestHistory.delete(client)
    }
  }

  function clientAddress(request: IncomingMessage) {
    const cloudflare = String(request.headers['cf-connecting-ip'] || '').trim()
    if (cloudflare) return cloudflare
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
    return forwarded || request.socket.remoteAddress || 'unknown'
  }

  function acceptGenerationRequest(request: IncomingMessage) {
    const activeTasks = [...tasks.values()].filter((task) => task.status === 0).length
    if (activeTasks >= MAX_ACTIVE_TASKS) {
      throw new CloudApiError(429, '当前已有音乐正在生成，请等待前面的任务完成')
    }

    const client = clientAddress(request)
    const now = Date.now()
    const recent = (requestHistory.get(client) || [])
      .filter((timestamp) => timestamp >= now - RATE_LIMIT_WINDOW_MS)
    if (recent.length >= MAX_TASKS_PER_WINDOW) {
      throw new CloudApiError(429, '生成请求过于频繁，请稍后再试')
    }
    recent.push(now)
    requestHistory.set(client, recent)
  }

  function storeAudio(key: string, audio: StoredAudio) {
    let totalBytes = [...audioCache.values()].reduce((total, item) => total + item.bytes.length, 0)
    for (const [oldestKey, oldest] of audioCache) {
      if (totalBytes + audio.bytes.length <= MAX_AUDIO_CACHE_BYTES) break
      audioCache.delete(oldestKey)
      totalBytes -= oldest.bytes.length
    }
    audioCache.set(key, audio)
  }

  async function fetchCloudJson(path: string, init: RequestInit, timeout = CLOUD_REQUEST_TIMEOUT_MS) {
    let response: Response
    try {
      response = await fetch(`${apiUrl}${path}`, {
        ...init,
        headers: { ...headers(), ...(init.headers || {}) },
        signal: AbortSignal.timeout(timeout),
      })
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new CloudApiError(504, 'ACE 云端生成超时，请稍后重试')
      }
      throw new CloudApiError(502, `无法连接 ACE 云端：${error instanceof Error ? error.message : '网络错误'}`)
    }

    const text = await response.text()
    let payload: unknown = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      if ([502, 503, 504].includes(response.status)) {
        throw new CloudApiError(response.status, `ACE 免费云端当前繁忙或排队超时（HTTP ${response.status}），请稍后重试`)
      }
      throw new CloudApiError(response.ok ? 502 : response.status, `ACE 云端返回了无法解析的响应（HTTP ${response.status}）`)
    }

    if (!response.ok) throw new CloudApiError(response.status, cloudErrorMessage(payload, response.status))
    return payload
  }

  async function checkCloudHealth() {
    if (!apiKey) return { ok: false, message: '尚未配置 ACESTEP_API_KEY' }
    if (generationFailure.until > Date.now()) {
      return { ok: false, message: generationFailure.message }
    }
    if (Date.now() - healthCache.checkedAt < HEALTH_CACHE_MS) return healthCache

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(`${apiUrl}/health`, {
        method: 'GET',
        headers: headers(),
        signal: controller.signal,
      })
      healthCache = {
        checkedAt: Date.now(),
        ok: response.ok,
        message: response.ok ? 'ok' : `ACE 云端健康检查失败（HTTP ${response.status}）`,
      }
    } catch (error) {
      healthCache = {
        checkedAt: Date.now(),
        ok: false,
        message: error instanceof DOMException && error.name === 'AbortError'
          ? 'ACE 云端健康检查超时，请稍后重试'
          : error instanceof Error ? error.message : 'ACE 云端不可用',
      }
    } finally {
      clearTimeout(timer)
    }
    return healthCache
  }

  async function buildCompletionRequest(generation: SanitizedGeneration) {
    const textContent = generation.sampleMode
      ? generation.sampleQuery
      : generation.prompt
    const contentParts: Array<Record<string, unknown>> = []

    if (generation.taskType === 'repaint') {
      const source = generation.sourceKey ? audioCache.get(generation.sourceKey) : undefined
      if (!source) throw new Error('源音频已经过期，请先重新生成音乐')
      contentParts.push({
        type: 'input_audio',
        input_audio: {
          data: source.bytes.toString('base64'),
          format: source.format,
        },
      })
    }

    // Emotion conditioning is text-only. The only permitted input_audio is the
    // source track required by repaint; normal generation never sends audio.
    const reference: LoadedReference | undefined = undefined
    const content: string | Array<Record<string, unknown>> = contentParts.length
      ? [{ type: 'text', text: textContent }, ...contentParts]
      : textContent

    const payload: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content }],
      modalities: ['audio'],
      stream: false,
      task_type: generation.taskType,
      sample_mode: generation.sampleMode,
      thinking: generation.sampleMode,
      use_format: false,
      use_cot_caption: generation.sampleMode && !generation.emotionAnalysis,
      use_cot_language: generation.sampleMode,
      use_cot_metas: generation.sampleMode,
      batch_size: 1,
      inference_steps: 8,
      audio_config: {
        format: 'wav',
        vocal_language: generation.vocalLanguage,
        instrumental: generation.instrumental,
        duration: generation.duration,
        bpm: generation.bpm,
        key_scale: generation.keyScale,
        time_signature: generation.timeSignature,
      },
    }

    if (!generation.sampleMode) payload.lyrics = generation.lyrics
    if (generation.taskType === 'repaint') {
      payload.thinking = false
      payload.use_cot_caption = false
      payload.use_cot_language = false
      payload.use_cot_metas = false
      payload.repainting_start = generation.repaintingStart
      payload.repainting_end = generation.repaintingEnd
      payload.audio_cover_strength = generation.repaintStrength
    }
    return { payload, reference }
  }

  async function executeTask(task: CloudTask, generation: SanitizedGeneration) {
    try {
        const request = await buildCompletionRequest(generation)
        const payload = await fetchCloudJson('/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify(request.payload),
        }) as CompletionPayload

      const choice = payload.choices?.[0]
      if (choice?.finish_reason === 'error') {
        throw new Error(choice.message?.content || 'ACE 云端生成失败')
      }

      const message = completionMessage(payload)
      const audioItems = Array.isArray(message?.audio)
        ? message.audio
        : Array.isArray(payload.audio) ? payload.audio : []
      if (!audioItems.length) {
        throw new Error(completionContent(payload) || 'ACE 云端没有返回音频')
      }

      const metadata = parseCompletionMetadata(completionContent(payload))
      const files = audioItems.map((item, index) => {
        const url = item.audio_url?.url || item.url || ''
        const decoded = mimeDetails(url)
        const key = `cloud/${task.id}-${index + 1}.${decoded.format}`
        storeAudio(key, { ...decoded, createdAt: Date.now() })
        return {
          file: `/v1/audio?path=${encodeURIComponent(key)}`,
          status: 1,
          seed_value: '',
          dit_model: payload.model || model,
          lm_model: generation.sampleMode ? 'ACE-Step cloud LM' : '',
          lyrics: generation.taskType === 'repaint'
            ? generation.lyrics
            : metadata.lyrics || generation.lyrics,
          caption: metadata.caption || generation.prompt,
          emotion_analysis: generation.emotionAnalysis,
          reference_audio: null,
          metas: {
            bpm: metadata.bpm || generation.bpm,
            duration: metadata.duration || generation.duration,
            keyscale: metadata.keyScale || generation.keyScale,
            timesignature: generation.timeSignature,
          },
        }
      })

      task.status = 1
      task.result = JSON.stringify(files)
      task.updatedAt = Date.now()
      generationFailure = { until: 0, message: '' }
    } catch (error) {
      task.status = 2
      task.error = error instanceof Error ? error.message : 'ACE 云端生成失败'
      task.updatedAt = Date.now()
      if (error instanceof CloudApiError && [502, 503, 504].includes(error.status)) {
        generationFailure = {
          until: Date.now() + 60_000,
          message: error.message,
        }
      }
    }
  }

  return {
    name: 'moodtrack-ace-step-cloud-proxy',
    configureServer(server) {
      if (!options.referenceRoot) {
        referenceRoot = resolve(server.config.root, 'emotion-reference-library')
      }

      server.middlewares.use('/emotion-reference-library', (_request, response) => {
        response.statusCode = 404
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end('Not found')
      })

      server.middlewares.use('/ace-step', async (request, response) => {
        pruneExpired()
        try {
          const url = new URL(request.url || '/', 'http://moodtrack.local')

          if (request.method === 'GET' && url.pathname === '/health') {
            const health = await checkCloudHealth()
            if (!health.ok) {
              sendError(response, 503, health.message)
              return
            }
            sendEnvelope(response, {
              status: 'ok',
              service: 'ACE-Step Cloud API',
              provider: apiUrl,
              model,
              text_agent: 'moodtrack-text-agent-v1',
              emotion_reference_categories: 0,
              reference_audio_enabled: false,
            })
            return
          }

          if (request.method === 'POST' && url.pathname === '/emotions/classify') {
            const context = sanitizeEmotionContext(await readJson(request))
            const analysis = { ...analyzeEmotionContext(context), referenceEmotionId: null }
            sendEnvelope(response, {
              ...analysis,
              reference: null,
            })
            return
          }

          if (request.method === 'POST' && url.pathname === '/release_task') {
            if (!apiKey) {
              sendError(response, 503, '尚未配置 ACESTEP_API_KEY，请先运行 scripts/configure-ace-cloud.ps1')
              return
            }
            const generation = sanitizeGeneration(await readJson(request))
            if (generation.sourceKey && !audioCache.has(generation.sourceKey)) {
              sendError(response, 410, '源音频已经过期，请先重新生成音乐')
              return
            }
            acceptGenerationRequest(request)

            const task: CloudTask = {
              id: randomUUID(),
              status: 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
            tasks.set(task.id, task)
            void executeTask(task, generation)
            sendEnvelope(response, { task_id: task.id, status: 'queued', queue_position: 1 })
            return
          }

          if (request.method === 'POST' && url.pathname === '/query_result') {
            const taskId = sanitizeQuery(await readJson(request))
            const task = tasks.get(taskId)
            if (!task) {
              sendEnvelope(response, [{ task_id: taskId, status: 2, error: '任务不存在或已经过期' }])
              return
            }
            sendEnvelope(response, [{
              task_id: task.id,
              status: task.status,
              result: task.result,
              error: task.error,
              message: task.error,
            }])
            return
          }

          if (request.method === 'GET' && url.pathname === '/v1/audio') {
            const key = url.searchParams.get('path') || ''
            if (!/^cloud\/[a-f0-9-]+\.(mp3|wav|flac|ogg|aac|m4a)$/i.test(key)) {
              sendError(response, 400, '音频地址无效')
              return
            }
            const audio = audioCache.get(key)
            if (!audio) {
              sendError(response, 410, '音频已经过期，请重新生成')
              return
            }
            response.statusCode = 200
            response.setHeader('Content-Type', audio.contentType)
            response.setHeader('Content-Length', String(audio.bytes.length))
            response.setHeader('Cache-Control', 'private, max-age=3600')
            response.setHeader('X-Content-Type-Options', 'nosniff')
            response.end(audio.bytes)
            return
          }

          sendError(response, 404, '不支持的 ACE-Step 操作')
        } catch (error) {
          if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
            sendError(response, 413, '请求内容过大')
          } else if (error instanceof Error && error.message === 'INVALID_JSON') {
            sendError(response, 400, '请求格式无效')
          } else if (error instanceof CloudApiError) {
            sendError(response, error.status >= 400 && error.status < 600 ? error.status : 502, error.message)
          } else {
            sendError(response, 502, error instanceof Error ? error.message : 'ACE 云端服务暂时不可用')
          }
        }
      })
    },
  }
}
