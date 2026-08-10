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

export type GvmgenResult = {
  jobId: string
  duration: number
  audioUrl: string
  videoUrl: string
}

const API_BASE = '/gvmgen'
const POLL_INTERVAL = 2_000
const GENERATION_TIMEOUT = 20 * 60_000

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

function heartArtMessage(message: string | undefined, fallback = '') {
  return (message || fallback)
    .replace(/GVM\s*Gen/gi, 'HeartArt')
    .replace(/ACE[\s-]*Step(?:\s*1\.5)?/gi, 'HeartArt')
}

async function readJson<T>(response: Response): Promise<T> {
  let payload: T & { detail?: string }
  try {
    payload = await response.json() as T & { detail?: string }
  } catch {
    throw new Error(`HeartArt 返回了无法解析的响应（HTTP ${response.status}）`)
  }
  if (!response.ok) throw new Error(heartArtMessage(payload.detail, `HeartArt 请求失败（HTTP ${response.status}）`))
  return payload
}

export async function checkGvmgenHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5_000) })
    const health = await readJson<{ ready: boolean }>(response)
    return health.ready
  } catch {
    return false
  }
}

export async function generateGvmgenSoundtrack(
  file: File,
  duration: number,
  onStatus?: (message: string, progress: number) => void,
): Promise<GvmgenResult> {
  const form = new FormData()
  form.append('video', file, file.name)
  form.append('duration', String(Math.max(5, Math.min(30, Math.round(duration)))))
  onStatus?.('正在上传视频到本机 HeartArt…', 8)

  const created = await readJson<{ job_id: string }>(await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    body: form,
  }))
  if (!created.job_id) throw new Error('HeartArt 没有返回任务编号')

  const startedAt = Date.now()
  while (Date.now() - startedAt < GENERATION_TIMEOUT) {
    await sleep(POLL_INTERVAL)
    const job = await readJson<GvmgenJob>(await fetch(`${API_BASE}/jobs/${created.job_id}`))
    onStatus?.(heartArtMessage(job.message), job.progress)
    if (job.status === 'failed') throw new Error(heartArtMessage(job.error, 'HeartArt 生成失败'))
    if (job.status !== 'completed') continue
    if (!job.audio_url || !job.video_url) throw new Error('HeartArt 已完成，但没有返回输出文件')
    return {
      jobId: job.id,
      duration: Number(job.duration) || duration,
      audioUrl: `${API_BASE}${job.audio_url}`,
      videoUrl: `${API_BASE}${job.video_url}`,
    }
  }

  throw new Error('HeartArt 生成超时，请稍后重试')
}
