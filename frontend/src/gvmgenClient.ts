import { validateFreshWav } from './audioValidation'

type GvmgenJob = {
  id: string
  status: 'queued' | 'loading' | 'generating' | 'rendering' | 'completed' | 'failed'
  progress: number
  message: string
  duration?: number
  audio_url?: string
  video_url?: string
  error?: string
}

type UploadSession = {
  upload_id: string
  filename?: string
  total_size?: number
  chunk_size: number
  total_chunks: number
  uploaded_chunks: number[]
  uploaded_bytes: number
  job_id?: string | null
}

type UploadMode = 'object-store' | 'chunked'

type MultipartUploadPart = {
  part_number: number
  upload_url: string
  upload_headers: Record<string, string>
  expires_in?: number
}

type ObjectUploadSession = {
  upload_id: string
  filename?: string
  total_size?: number
  content_type?: string
  uploaded: boolean
  job_id?: string | null
  upload_url?: string
  upload_headers: Record<string, string>
  expires_in?: number
  upload_strategy: 'single' | 'multipart'
  part_size?: number
  total_parts?: number
  uploaded_parts: number[]
  parts: MultipartUploadPart[]
}

export type GvmgenResult = {
  jobId: string
  duration: number
  audioUrl: string
  videoUrl: string
  audioDigest: string
}

const API_BASE = '/gvmgen'
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const POLL_INTERVAL = 2_000
const GENERATION_TIMEOUT = 30 * 60_000
const MAX_TRANSIENT_FAILURES = 30
const MAX_REQUEST_ATTEMPTS = 6
const MAX_CHUNK_UPLOAD_ATTEMPTS = 4
const MAX_OBJECT_UPLOAD_ATTEMPTS = 3
const MULTIPART_UPLOAD_CONCURRENCY = 3
const SAFE_ID = /^[a-f0-9]{32}$/i

class GvmgenHttpError extends Error {
  status: number
  retryAfterSeconds: number

  constructor(message: string, status: number, retryAfterSeconds = 0) {
    super(message)
    this.name = 'GvmgenHttpError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

function moodTrackMessage(message: string | undefined, fallback = '') {
  return (message || fallback)
    .replace(/Heart\s*Art/gi, 'MoodTrack')
    .replace(/GVM\s*Gen/gi, 'MoodTrack')
    .replace(/ACE[\s-]*Step(?:\s*1\.5)?/gi, 'MoodTrack')
}

function statusMessage(status: number, detail?: string) {
  if (detail) return moodTrackMessage(detail)
  if (status === 413) return '视频文件过大，请选择不超过 50MB 的视频'
  if (status === 429) return '视频生成服务正在处理其他任务，请稍后再试'
  if (status === 524) return '公网视频上传连接超时，MoodTrack 将自动续传当前分片'
  if ([502, 503, 504].includes(status)) return '视频服务连接暂时不可用，请稍后再试'
  return `MoodTrack 请求失败（HTTP ${status}）`
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  let payload: (T & { detail?: string }) | null = null
  if (text) {
    try {
      payload = JSON.parse(text) as T & { detail?: string }
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    throw new GvmgenHttpError(statusMessage(response.status, payload?.detail), response.status, retryAfter)
  }
  if (!payload) throw new GvmgenHttpError(`MoodTrack 返回了无法解析的响应（HTTP ${response.status}）`, response.status)
  return payload
}

function isTransient(error: unknown) {
  if (error instanceof GvmgenHttpError) return [408, 425, 500, 502, 503, 504, 524].includes(error.status)
  if (error instanceof DOMException) return error.name === 'AbortError' || error.name === 'TimeoutError'
  return error instanceof TypeError
}

async function requestWithRetry<T>(
  request: () => Promise<Response>,
  onRetry: (attempt: number) => void,
  maxAttempts = MAX_REQUEST_ATTEMPTS,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await readJson<T>(await request())
    } catch (error) {
      lastError = error
      if (!isTransient(error) || attempt === maxAttempts) throw error
      onRetry(attempt)
      const retryAfter = error instanceof GvmgenHttpError ? error.retryAfterSeconds * 1_000 : 0
      const backoff = Math.min(12_000, 900 * (2 ** (attempt - 1))) + Math.round(Math.random() * 350)
      await sleep(Math.max(retryAfter, backoff))
    }
  }
  throw lastError
}

function createClientRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '')
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clearLegacyUploadState() {
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index)
      if (key?.startsWith('moodtrack:gvmgen-upload:')) window.sessionStorage.removeItem(key)
    }
  } catch {
    // Browsers may disable sessionStorage in strict privacy modes.
  }
  const url = new URL(window.location.href)
  if (url.searchParams.has('resumeUpload')) {
    url.searchParams.delete('resumeUpload')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
}

clearLegacyUploadState()

function validateUploadSession(value: unknown, file: File): UploadSession {
  if (!isRecord(value)) throw new Error('MoodTrack 返回的上传会话无效')
  const uploadId = String(value.upload_id || '')
  const chunkSize = Number(value.chunk_size)
  const totalChunks = Number(value.total_chunks)
  const uploadedBytes = Number(value.uploaded_bytes)
  const filename = typeof value.filename === 'string' ? value.filename : undefined
  const totalSize = value.total_size === undefined ? undefined : Number(value.total_size)
  const rawUploaded = Array.isArray(value.uploaded_chunks) ? value.uploaded_chunks : []
  const uploadedChunks = rawUploaded.map(Number)
  const uniqueChunks = new Set(uploadedChunks)
  const rawJobId = value.job_id
  const jobId = typeof rawJobId === 'string' && SAFE_ID.test(rawJobId) ? rawJobId : null

  if (
    !SAFE_ID.test(uploadId)
    || !Number.isInteger(chunkSize)
    || chunkSize <= 0
    || !Number.isInteger(totalChunks)
    || totalChunks !== Math.ceil(file.size / chunkSize)
    || !Number.isFinite(uploadedBytes)
    || uploadedBytes < 0
    || uploadedBytes > file.size
    || uploadedChunks.length !== uniqueChunks.size
    || uploadedChunks.some((index) => !Number.isInteger(index) || index < 0 || index >= totalChunks)
    || (filename !== undefined && filename !== file.name)
    || (totalSize !== undefined && totalSize !== file.size)
    || (rawJobId !== undefined && rawJobId !== null && !jobId)
  ) {
    throw new Error('恢复任务与当前视频不匹配，请重新选择之前上传的同一个视频')
  }

  return {
    upload_id: uploadId,
    filename,
    total_size: totalSize,
    chunk_size: chunkSize,
    total_chunks: totalChunks,
    uploaded_chunks: uploadedChunks,
    uploaded_bytes: uploadedBytes,
    job_id: jobId,
  }
}

function validateCloudUploadHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('MoodTrack 返回的云端上传请求头无效')
  const headers: Record<string, string> = {}
  for (const [name, headerValue] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof headerValue !== 'string') {
      throw new Error('MoodTrack 返回的云端上传请求头无效')
    }
    const lowerName = name.toLowerCase()
    if (['authorization', 'cookie', 'host', 'content-length', 'origin', 'referer', 'user-agent'].includes(lowerName)) {
      throw new Error('MoodTrack 返回了浏览器不允许设置的云端请求头')
    }
    headers[name] = headerValue
  }
  return headers
}

function validateCloudUploadUrl(value: unknown) {
  if (typeof value !== 'string' || !value) throw new Error('MoodTrack 返回的云端上传地址无效')
  try {
    if (new URL(value).protocol !== 'https:') throw new Error('not https')
  } catch {
    throw new Error('MoodTrack 返回的云端上传地址无效')
  }
  return value
}

function validateObjectUploadSession(value: unknown, file: File): ObjectUploadSession {
  if (!isRecord(value)) throw new Error('MoodTrack 返回的云端上传会话无效')
  const uploadId = String(value.upload_id || '')
  const filename = typeof value.filename === 'string' ? value.filename : undefined
  const totalSize = value.total_size === undefined ? undefined : Number(value.total_size)
  const contentType = typeof value.content_type === 'string' ? value.content_type : undefined
  const uploaded = value.uploaded === true
  const rawJobId = value.job_id
  const jobId = typeof rawJobId === 'string' && SAFE_ID.test(rawJobId) ? rawJobId : null
  const uploadStrategy = value.upload_strategy === 'multipart' ? 'multipart' : 'single'
  const uploadUrl = value.upload_url === undefined ? undefined : validateCloudUploadUrl(value.upload_url)
  const expiresIn = value.expires_in === undefined ? undefined : Number(value.expires_in)
  const uploadHeaders = validateCloudUploadHeaders(value.upload_headers)
  const partSize = value.part_size === undefined ? undefined : Number(value.part_size)
  const totalParts = value.total_parts === undefined ? undefined : Number(value.total_parts)
  const uploadedParts = Array.isArray(value.uploaded_parts) ? value.uploaded_parts.map(Number) : []
  const rawParts = value.parts === undefined ? [] : value.parts
  if (!Array.isArray(rawParts)) throw new Error('MoodTrack 返回的云端分片上传地址无效')
  const parts = rawParts.map((rawPart): MultipartUploadPart => {
    if (!isRecord(rawPart)) throw new Error('MoodTrack 返回的云端分片上传地址无效')
    const partNumber = Number(rawPart.part_number)
    const partExpiresIn = rawPart.expires_in === undefined ? undefined : Number(rawPart.expires_in)
    if (
      !Number.isInteger(partNumber)
      || partNumber <= 0
      || (partExpiresIn !== undefined && (!Number.isFinite(partExpiresIn) || partExpiresIn <= 0))
    ) {
      throw new Error('MoodTrack 返回的云端分片上传地址无效')
    }
    return {
      part_number: partNumber,
      upload_url: validateCloudUploadUrl(rawPart.upload_url),
      upload_headers: validateCloudUploadHeaders(rawPart.upload_headers),
      expires_in: partExpiresIn,
    }
  })
  const uploadedPartSet = new Set(uploadedParts)
  const pendingPartNumbers = parts.map((part) => part.part_number)
  const pendingPartSet = new Set(pendingPartNumbers)

  if (
    !SAFE_ID.test(uploadId)
    || (filename !== undefined && filename !== file.name)
    || (totalSize !== undefined && totalSize !== file.size)
    || (rawJobId !== undefined && rawJobId !== null && !jobId)
    || (expiresIn !== undefined && (!Number.isFinite(expiresIn) || expiresIn <= 0))
    || (uploadStrategy === 'single' && !uploaded && !jobId && !uploadUrl)
    || (uploadStrategy === 'multipart' && (
      !Number.isInteger(partSize)
      || !partSize
      || partSize <= 0
      || !Number.isInteger(totalParts)
      || !totalParts
      || totalParts !== Math.ceil(file.size / partSize)
      || uploadedPartSet.size !== uploadedParts.length
      || pendingPartSet.size !== pendingPartNumbers.length
      || uploadedParts.some((partNumber) => !Number.isInteger(partNumber) || partNumber <= 0 || partNumber > totalParts)
      || pendingPartNumbers.some((partNumber) => partNumber > totalParts || uploadedPartSet.has(partNumber))
      || (!uploaded && !jobId && uploadedParts.length + parts.length !== totalParts)
    ))
  ) {
    throw new Error('云端上传任务与当前视频不匹配，请重新选择同一个视频')
  }

  return {
    upload_id: uploadId,
    filename,
    total_size: totalSize,
    content_type: contentType,
    uploaded,
    job_id: jobId,
    upload_url: uploadUrl,
    upload_headers: uploadHeaders,
    expires_in: expiresIn,
    upload_strategy: uploadStrategy,
    part_size: partSize,
    total_parts: totalParts,
    uploaded_parts: uploadedParts,
    parts,
  }
}

async function createUploadSession(
  file: File,
  duration: number,
  clientRequestId: string,
  onStatus?: (message: string, progress: number) => void,
) {
  const value = await requestWithRetry<unknown>(
    () => fetch(`${API_BASE}/uploads`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        duration: Math.max(5, Math.min(30, Math.round(duration))),
        client_request_id: clientRequestId,
      }),
      signal: AbortSignal.timeout(20_000),
    }),
    () => onStatus?.('正在重新连接视频上传服务…', 4),
  )
  return validateUploadSession(value, file)
}

async function openUploadSession(
  file: File,
  duration: number,
  onStatus?: (message: string, progress: number) => void,
) {
  const clientRequestId = createClientRequestId()
  return createUploadSession(file, duration, clientRequestId, onStatus)
}

async function createObjectUploadSession(
  file: File,
  duration: number,
  clientRequestId: string,
  onStatus?: (message: string, progress: number) => void,
) {
  const value = await requestWithRetry<unknown>(
    () => fetch(`${API_BASE}/object-uploads`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        duration: Math.max(5, Math.min(30, Math.round(duration))),
        content_type: file.type || 'application/octet-stream',
        client_request_id: clientRequestId,
      }),
      signal: AbortSignal.timeout(20_000),
    }),
    () => onStatus?.('正在重新连接高速云存储…', 4),
  )
  return validateObjectUploadSession(value, file)
}

async function refreshObjectUploadSession(file: File, uploadId: string) {
  const value = await requestWithRetry<unknown>(
    () => fetch(`${API_BASE}/object-uploads/${uploadId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    }),
    () => undefined,
    3,
  )
  return validateObjectUploadSession(value, file)
}

async function openObjectUploadSession(
  file: File,
  duration: number,
  onStatus?: (message: string, progress: number) => void,
) {
  const clientRequestId = createClientRequestId()
  return createObjectUploadSession(file, duration, clientRequestId, onStatus)
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.max(0, Math.round(bytes))} B`
}

function putObjectWithProgress(
  file: File,
  session: ObjectUploadSession,
  onStatus?: (message: string, progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    if (!session.upload_url) {
      reject(new Error('云端上传授权缺失，请重新点击生成'))
      return
    }

    const startedAt = performance.now()
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', session.upload_url, true)
    for (const [name, value] of Object.entries(session.upload_headers)) xhr.setRequestHeader(name, value)
    const expiresIn = session.expires_in || 20 * 60
    xhr.timeout = Math.max(2 * 60_000, Math.min(30 * 60_000, (expiresIn + 30) * 1_000))

    xhr.upload.onprogress = (event) => {
      const loaded = Math.min(file.size, Math.max(0, event.loaded))
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size
      const ratio = total > 0 ? Math.min(1, loaded / total) : 0
      const phaseProgress = Math.round(ratio * 100)
      const overallProgress = 5 + Math.round(ratio * 15)
      const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1_000)
      const bytesPerSecond = loaded / elapsedSeconds
      const remainingSeconds = bytesPerSecond > 0 ? Math.max(0, (file.size - loaded) / bytesPerSecond) : 0
      const speed = elapsedSeconds >= 0.8 && loaded > 0 ? ` · ${formatBytes(bytesPerSecond)}/s` : ''
      const eta = elapsedSeconds >= 0.8 && remainingSeconds > 0
        ? remainingSeconds < 60
          ? ` · 约 ${Math.ceil(remainingSeconds)} 秒`
          : ` · 约 ${Math.ceil(remainingSeconds / 60)} 分钟`
        : ''
      onStatus?.(
        `正在直传云存储 · ${phaseProgress}% · ${formatBytes(loaded)}/${formatBytes(file.size)}${speed}${eta} · 请勿刷新页面`,
        overallProgress,
      )
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      const message = xhr.status === 403
        ? '云存储上传授权已过期'
        : `云存储上传失败（HTTP ${xhr.status}）`
      reject(new GvmgenHttpError(message, xhr.status))
    }
    xhr.onerror = () => reject(new TypeError('浏览器与云存储的连接中断'))
    xhr.ontimeout = () => reject(new DOMException('云存储上传超时', 'TimeoutError'))
    xhr.onabort = () => reject(new DOMException('云存储上传已取消', 'AbortError'))
    xhr.send(file)
  })
}

function isObjectUploadTransient(error: unknown) {
  if (error instanceof GvmgenHttpError) {
    return [403, 408, 425, 429, 500, 502, 503, 504].includes(error.status)
  }
  if (error instanceof DOMException) return error.name === 'TimeoutError'
  return error instanceof TypeError
}

function putMultipartPartWithProgress(
  body: Blob,
  part: MultipartUploadPart,
  onProgress: (loaded: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', part.upload_url, true)
    for (const [name, value] of Object.entries(part.upload_headers)) xhr.setRequestHeader(name, value)
    const expiresIn = part.expires_in || 20 * 60
    xhr.timeout = Math.max(2 * 60_000, Math.min(30 * 60_000, (expiresIn + 30) * 1_000))
    xhr.upload.onprogress = (event) => onProgress(Math.min(body.size, Math.max(0, event.loaded)))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(body.size)
        resolve()
        return
      }
      const message = xhr.status === 403
        ? '云存储分片上传授权已过期'
        : `云存储分片上传失败（HTTP ${xhr.status}）`
      reject(new GvmgenHttpError(message, xhr.status))
    }
    xhr.onerror = () => reject(new TypeError('浏览器与云存储的分片连接中断'))
    xhr.ontimeout = () => reject(new DOMException('云存储分片上传超时', 'TimeoutError'))
    xhr.onabort = () => reject(new DOMException('云存储分片上传已取消', 'AbortError'))
    xhr.send(body)
  })
}

async function uploadVideoMultipart(
  file: File,
  initialSession: ObjectUploadSession,
  onStatus?: (message: string, progress: number) => void,
) {
  const partSize = initialSession.part_size
  const totalParts = initialSession.total_parts
  if (!partSize || !totalParts) throw new Error('云存储分片参数缺失，请重新点击生成')

  const loadedByPart = new Map<number, number>()
  const expectedPartBytes = (partNumber: number) => {
    const start = (partNumber - 1) * partSize
    return Math.max(0, Math.min(partSize, file.size - start))
  }
  for (const partNumber of initialSession.uploaded_parts) {
    loadedByPart.set(partNumber, expectedPartBytes(partNumber))
  }
  const startedAt = performance.now()
  const initiallyUploaded = [...loadedByPart.values()].reduce((sum, value) => sum + value, 0)

  const emitProgress = (retrying = false) => {
    const loaded = Math.min(file.size, [...loadedByPart.values()].reduce((sum, value) => sum + value, 0))
    const ratio = file.size > 0 ? loaded / file.size : 0
    const phaseProgress = Math.round(ratio * 100)
    const overallProgress = 5 + Math.round(ratio * 15)
    const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1_000)
    const uploadedThisRun = Math.max(0, loaded - initiallyUploaded)
    const bytesPerSecond = uploadedThisRun / elapsedSeconds
    const remainingSeconds = bytesPerSecond > 0 ? Math.max(0, (file.size - loaded) / bytesPerSecond) : 0
    const speed = elapsedSeconds >= 0.8 && uploadedThisRun > 0 ? ` · ${formatBytes(bytesPerSecond)}/s` : ''
    const eta = elapsedSeconds >= 0.8 && remainingSeconds > 0
      ? remainingSeconds < 60
        ? ` · 约 ${Math.ceil(remainingSeconds)} 秒`
        : ` · 约 ${Math.ceil(remainingSeconds / 60)} 分钟`
      : ''
    onStatus?.(
      `${retrying ? '正在重试云存储分片' : '正在并发直传云存储'} · ${phaseProgress}% · ${formatBytes(loaded)}/${formatBytes(file.size)}${speed}${eta} · 请勿刷新页面`,
      overallProgress,
    )
  }

  const pendingPartNumbers = Array.from({ length: totalParts }, (_, index) => index + 1)
    .filter((partNumber) => !initialSession.uploaded_parts.includes(partNumber))
  const initialParts = new Map(initialSession.parts.map((part) => [part.part_number, part]))
  let cursor = 0

  const uploadPart = async (partNumber: number) => {
    let descriptor = initialParts.get(partNumber)
    if (!descriptor) throw new Error(`云存储缺少第 ${partNumber} 个分片上传地址`)
    const start = (partNumber - 1) * partSize
    const body = file.slice(start, start + expectedPartBytes(partNumber))
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_OBJECT_UPLOAD_ATTEMPTS; attempt += 1) {
      loadedByPart.set(partNumber, 0)
      if (attempt > 1) emitProgress(true)
      try {
        await putMultipartPartWithProgress(body, descriptor, (loaded) => {
          loadedByPart.set(partNumber, loaded)
          emitProgress()
        })
        loadedByPart.set(partNumber, body.size)
        emitProgress()
        return
      } catch (error) {
        lastError = error
        loadedByPart.set(partNumber, 0)
        if (!isObjectUploadTransient(error) || attempt === MAX_OBJECT_UPLOAD_ATTEMPTS) throw error
        await sleep(Math.min(8_000, 1_000 * (2 ** (attempt - 1))))
        const refreshed = await refreshObjectUploadSession(file, initialSession.upload_id)
        if (refreshed.uploaded || refreshed.job_id || refreshed.uploaded_parts.includes(partNumber)) {
          loadedByPart.set(partNumber, body.size)
          emitProgress()
          return
        }
        descriptor = refreshed.parts.find((part) => part.part_number === partNumber)
        if (!descriptor) throw new Error(`云存储无法刷新第 ${partNumber} 个分片上传地址`)
      }
    }
    throw lastError
  }

  emitProgress()
  const workerCount = Math.min(MULTIPART_UPLOAD_CONCURRENCY, pendingPartNumbers.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < pendingPartNumbers.length) {
      const partNumber = pendingPartNumbers[cursor]
      cursor += 1
      await uploadPart(partNumber)
    }
  }))
}

async function uploadVideoToObjectStore(
  file: File,
  initialSession: ObjectUploadSession,
  onStatus?: (message: string, progress: number) => void,
) {
  let session = initialSession
  if (session.uploaded || session.job_id) return
  if (session.upload_strategy === 'multipart') {
    await uploadVideoMultipart(file, session, onStatus)
    return
  }
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_OBJECT_UPLOAD_ATTEMPTS; attempt += 1) {
    onStatus?.(
      attempt === 1
        ? `正在直传云存储 · 0% · 0 B/${formatBytes(file.size)} · 请勿刷新页面`
        : `正在重新连接云存储（第 ${attempt}/${MAX_OBJECT_UPLOAD_ATTEMPTS} 次）…`,
      5,
    )
    try {
      await putObjectWithProgress(file, session, onStatus)
      return
    } catch (error) {
      lastError = error
      if (!isObjectUploadTransient(error) || attempt === MAX_OBJECT_UPLOAD_ATTEMPTS) throw error
      await sleep(Math.min(8_000, 1_000 * (2 ** (attempt - 1))))
      try {
        session = await refreshObjectUploadSession(file, session.upload_id)
        if (session.uploaded || session.job_id) return
      } catch (refreshError) {
        if (refreshError instanceof GvmgenHttpError && refreshError.status === 404) throw refreshError
      }
    }
  }
  throw lastError
}

async function completeObjectUpload(
  session: ObjectUploadSession,
  onStatus?: (message: string, progress: number) => void,
) {
  if (session.job_id) return { job_id: session.job_id }
  return requestWithRetry<{ job_id: string }>(
    () => fetch(`${API_BASE}/object-uploads/${session.upload_id}/complete`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    }),
    () => onStatus?.('视频已上传云存储，正在重新确认生成任务…', 20),
  )
}

async function uploadVideoInChunks(
  file: File,
  session: UploadSession,
  onStatus?: (message: string, progress: number) => void,
) {
  const uploaded = new Set(
    (session.uploaded_chunks || []).filter((index) => index >= 0 && index < session.total_chunks),
  )
  let confirmedBytes = [...uploaded].reduce((total, index) => {
    const start = index * session.chunk_size
    const end = Math.min(file.size, start + session.chunk_size)
    return total + Math.max(0, end - start)
  }, 0)
  const pending = Array.from(
    { length: session.total_chunks },
    (_, index) => index,
  ).filter((index) => !uploaded.has(index))
  const startedAt = performance.now()
  const startedBytes = confirmedBytes

  const emitUploadProgress = (retrying = false) => {
    const phaseProgress = Math.min(100, Math.round((confirmedBytes / file.size) * 100))
    const overallProgress = 5 + Math.round((confirmedBytes / file.size) * 15)
    const uploadedThisRun = confirmedBytes - startedBytes
    const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1_000)
    const remainingBytes = Math.max(0, file.size - confirmedBytes)
    let eta = '正在估算剩余时间'
    if (uploadedThisRun > 0 && remainingBytes > 0) {
      const remainingSeconds = Math.min(99 * 60, Math.max(1, (remainingBytes / uploadedThisRun) * elapsedSeconds))
      eta = remainingSeconds < 60
        ? `预计剩余 ${Math.ceil(remainingSeconds)} 秒`
        : `预计剩余约 ${Math.ceil(remainingSeconds / 60)} 分钟`
    } else if (remainingBytes === 0) {
      eta = '上传即将完成'
    }
    onStatus?.(
      retrying
        ? `网络短暂波动，正在续传当前分片 · ${phaseProgress}% · 已完成 ${uploaded.size}/${session.total_chunks} 个分片 · ${eta} · 请勿刷新页面`
        : `正在上传视频 · ${phaseProgress}% · 已完成 ${uploaded.size}/${session.total_chunks} 个分片 · ${eta} · 请勿刷新页面`,
      overallProgress,
    )
  }

  emitUploadProgress()

  for (const index of pending) {
    const start = index * session.chunk_size
    const end = Math.min(file.size, start + session.chunk_size)
    const chunk = file.slice(start, end)
    await requestWithRetry<unknown>(
      () => fetch(`${API_BASE}/uploads/${session.upload_id}/chunks/${index}`, {
        method: 'PUT',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${start}-${end - 1}/${file.size}`,
        },
        body: chunk,
        signal: AbortSignal.timeout(75_000),
      }),
      () => emitUploadProgress(true),
      MAX_CHUNK_UPLOAD_ATTEMPTS,
    )
    if (!uploaded.has(index)) {
      uploaded.add(index)
      confirmedBytes += end - start
    }
    emitUploadProgress()
  }
}

async function completeUpload(session: UploadSession, onStatus?: (message: string, progress: number) => void) {
  if (session.job_id) return { job_id: session.job_id }
  return requestWithRetry<{ job_id: string }>(
    () => fetch(`${API_BASE}/uploads/${session.upload_id}/complete`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    }),
    () => onStatus?.('视频已经上传，正在重新确认生成任务…', 20),
  )
}

async function getGvmgenUploadMode(): Promise<UploadMode> {
  const health = await requestWithRetry<{ ready: boolean; upload_mode?: string }>(
    () => fetch(`${API_BASE}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) }),
    () => undefined,
    3,
  )
  if (!health.ready) throw new Error('视频生成服务尚未就绪，请稍后再试')
  if (health.upload_mode === 'object-store' || health.upload_mode === 'chunked') return health.upload_mode
  throw new Error('视频生成服务返回了不支持的上传模式')
}

export async function checkGvmgenHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
    const health = await readJson<{ ready: boolean; upload_mode?: string }>(response)
    return health.ready && (health.upload_mode === 'object-store' || health.upload_mode === 'chunked')
  } catch {
    return false
  }
}

export async function generateGvmgenSoundtrack(
  file: File,
  duration: number,
  onStatus?: (message: string, progress: number) => void,
  excludedAudioDigests: string[] = [],
): Promise<GvmgenResult> {
  if (file.size > MAX_VIDEO_BYTES) throw new Error('视频文件过大，请选择不超过 50MB 的视频')
  let lastProgress = 0
  const emitStatus = (message: string, progress: number) => {
    lastProgress = Math.max(lastProgress, Math.min(100, Math.max(0, Math.round(progress))))
    onStatus?.(message, lastProgress)
  }

  emitStatus('正在检查高速上传通道…', 3)
  const uploadMode = await getGvmgenUploadMode()
  let created: { job_id: string }

  if (uploadMode === 'object-store') {
    emitStatus('正在建立云存储直传…', 4)
    const session = await openObjectUploadSession(file, duration, emitStatus)
    if (!session.job_id && !session.uploaded) {
      await uploadVideoToObjectStore(file, session, emitStatus)
    }
    emitStatus('视频已直传云存储，正在创建生成任务…', 20)
    created = await completeObjectUpload(session, emitStatus)
  } else {
    emitStatus('正在建立安全分片上传…', 4)
    const session = await openUploadSession(file, duration, emitStatus)
    if (!session.job_id) await uploadVideoInChunks(file, session, emitStatus)
    emitStatus('视频上传完成，正在创建生成任务…', 20)
    created = await completeUpload(session, emitStatus)
  }
  if (!created.job_id || !SAFE_ID.test(created.job_id)) throw new Error('MoodTrack 没有返回有效任务编号')

  const startedAt = Date.now()
  let transientFailures = 0
  while (Date.now() - startedAt < GENERATION_TIMEOUT) {
    await sleep(Math.min(15_000, POLL_INTERVAL * Math.max(1, transientFailures)))
    let job: GvmgenJob
    try {
      job = await readJson<GvmgenJob>(await fetch(`${API_BASE}/jobs/${created.job_id}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      }))
      if (job.id !== created.job_id) throw new Error('MoodTrack 返回了其他视频任务，已阻止旧结果覆盖')
      transientFailures = 0
    } catch (error) {
      transientFailures += 1
      if (error instanceof GvmgenHttpError && error.status === 404) {
        throw new Error('之前的视频任务已经过期，请重新点击生成')
      }
      if (!isTransient(error) || transientFailures > MAX_TRANSIENT_FAILURES) throw error
      emitStatus('公网连接短暂波动，正在重新连接 MoodTrack 任务…', 22)
      continue
    }
    emitStatus(moodTrackMessage(job.message), job.progress)
    if (job.status === 'failed') {
      throw new Error(moodTrackMessage(job.error, 'MoodTrack 生成失败'))
    }
    if (job.status !== 'completed') continue
    if (!job.audio_url || !job.video_url) throw new Error('MoodTrack 已完成，但没有返回输出文件')
    const resultVersion = encodeURIComponent(`${job.id}-${Date.now()}`)
    const resultDuration = Number(job.duration) || duration
    const audioUrl = `${API_BASE}${job.audio_url}?v=${resultVersion}`
    const audioResponse = await fetch(audioUrl, { cache: 'no-store' })
    if (!audioResponse.ok) throw new Error(`无法校验视频配乐（HTTP ${audioResponse.status}）`)
    const validated = await validateFreshWav(await audioResponse.blob(), resultDuration, excludedAudioDigests)
    const result = {
      jobId: job.id,
      duration: validated.duration,
      audioUrl,
      videoUrl: `${API_BASE}${job.video_url}?v=${resultVersion}`,
      audioDigest: validated.sha256,
    }
    return result
  }

  throw new Error('MoodTrack 生成仍在后台运行，请稍后再试')
}
