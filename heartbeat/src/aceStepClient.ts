type MoodPoint = {
  label: string
  time: number
  intensity: number
}

type AceStepOptions = {
  title: string
  scene: string
  style: string
  instruments: string[]
  productionPrompt: string
  instrumentalStructure: string
  presetId: string
  musicKey: string
  bpm: number
  duration: number
  moods: MoodPoint[]
  instrumental: boolean
  variation: number
  onStatus?: (message: string) => void
}

type ApiEnvelope<T> = {
  data: T
  code: number
  error?: string | null
}

type TaskResult = {
  task_id: string
  status: number
  result?: string | Array<GeneratedFile>
  error?: string
  message?: string
}

type GeneratedFile = {
  file?: string
  status?: number
  seed_value?: string
  dit_model?: string
  lm_model?: string
  metas?: {
    duration?: number
  }
}

export type AceStepSoundtrack = {
  audio: Blob
  taskId: string
  seed: string
  model: string
  duration: number
  variationName: string
  sourceFile: string
}

export type AceStepRepaintOptions = {
  sourceFile: string
  prompt: string
  bpm: number
  musicKey: string
  duration: number
  start: number
  end: number
  strength: number
  onStatus?: (message: string) => void
}

type CompositionVariant = {
  name: string
  direction: string
  section: string
}

const compositionVariants: Record<string, CompositionVariant[]> = {
  midnight: [
    { name: '旋律巡航', direction: 'Rhodes-led melody with wide intervals, patient four-bar phrases and a restrained backbeat.', section: '[Instrumental - a new Rhodes-led theme with wide intervals and patient phrasing]' },
    { name: '琶音推进', direction: 'Rhythm-led form built from a bright sixteenth-note arpeggiator and syncopated bass movement.', section: '[Instrumental - arpeggiator-led drive with syncopated bass and short melodic fragments]' },
    { name: '半拍夜雾', direction: 'Half-time nocturnal arrangement with long pad chords, sparse piano notes and large pockets of silence.', section: '[Instrumental - half-time night fog with long pads, sparse Rhodes and spacious rests]' },
    { name: '低频脉动', direction: 'Bass-led composition with a new descending hook, punchier drum-machine accents and filtered synth stabs.', section: '[Instrumental - descending bass hook with punchy LinnDrum accents and filtered synth stabs]' },
    { name: '霓虹对答', direction: 'Call-and-response between Rhodes and analog pluck, changing registers every two phrases.', section: '[Instrumental - neon call-and-response between Rhodes and analog pluck in contrasting registers]' },
    { name: '无鼓黎明', direction: 'Begin without drums, develop an evolving pad motif, then introduce the full groove only near the climax.', section: '[Instrumental - drumless evolving pad motif that blooms into a late full-groove climax]' },
  ],
  graduation: [
    { name: '钢琴回忆', direction: 'Felt-piano-led theme with a simple singable contour, gentle variations and a late chamber-string answer.', section: '[Instrumental - felt piano states a new memory theme before chamber strings answer]' },
    { name: '木吉他旅途', direction: 'Fingerpicked-guitar-led form with moving inner voices, light brush groove and piano used only as punctuation.', section: '[Instrumental - fingerpicked guitar leads while brushed drums and sparse piano support]' },
    { name: '弦乐成长', direction: 'Cello begins alone, viola counterpoint gradually expands, and piano enters only at the emotional peak.', section: '[Instrumental - solo cello grows into layered viola counterpoint before piano joins the climax]' },
    { name: '光点主题', direction: 'A delicate glockenspiel motif introduces the piece, answered by felt piano and warm acoustic guitar.', section: '[Instrumental - glockenspiel light motif answered by felt piano and acoustic guitar]' },
    { name: '室内乐对答', direction: 'Conversational chamber arrangement with alternating piano, guitar and cello phrases instead of one repeated hook.', section: '[Instrumental - conversational phrases rotate between piano, guitar and cello]' },
    { name: '克制终章', direction: 'Start near silence, use slow harmonic rhythm and reserve the only full ensemble statement for the final third.', section: '[Instrumental - near-silent opening and slow harmony lead to one restrained final ensemble statement]' },
  ],
  battle: [
    { name: '低弦突击', direction: 'String-led assault with a new asymmetric spiccato ostinato, sharp accents and brass reserved for cadences.', section: '[Instrumental - asymmetric low-string ostinato drives the attack while brass marks cadences]' },
    { name: '铜管号令', direction: 'Brass-led battle form with a bold rising horn theme, short trumpet answers and drums supporting the melody.', section: '[Instrumental - rising French-horn command theme with trumpet answers and supporting war drums]' },
    { name: '太鼓围攻', direction: 'Percussion-led composition built from interlocking taiko and tom patterns, sparse low strings and delayed brass.', section: '[Instrumental - interlocking taiko and tom siege rhythm with sparse strings and delayed brass]' },
    { name: '混合脉冲', direction: 'Electronic-pulse-led hybrid score with syncopated low synth, string stabs and a sudden orchestral takeover.', section: '[Instrumental - syncopated hybrid pulse and string stabs trigger a sudden orchestral takeover]' },
    { name: '英雄主题', direction: 'Theme-led heroic arc with a broad horn melody, descending string counterline and a clear victorious reprise.', section: '[Instrumental - broad heroic horn melody gains a descending string counterline and victorious reprise]' },
    { name: '静默反击', direction: 'Open with tense tremolo and sub pulse, insert a near-silent breakdown, then unleash a double-time final attack.', section: '[Instrumental - tense tremolo collapses into silence before a double-time final counterattack]' },
  ],
  launch: [
    { name: '玻璃标识', direction: 'Pluck-led cue built around a new three-note glass motif that evolves into a concise sonic logo.', section: '[Instrumental - three-note glass motif develops into a concise premium sonic logo]' },
    { name: '脉冲推进', direction: 'Bass-led progressive build with a clean repeating pulse, restrained drums and widening harmonic layers.', section: '[Instrumental - clean pulse bass drives a progressive build as harmonic layers widen]' },
    { name: '数字切分', direction: 'Percussion-led form with syncopated digital clicks, clipped synth chords and stop-start product transitions.', section: '[Instrumental - syncopated digital percussion and clipped synth chords create stop-start transitions]' },
    { name: '空间揭晓', direction: 'Ambient-first reveal with airy pads, isolated plucks and no full beat until the final product moment.', section: '[Instrumental - airy ambient space and isolated plucks delay the full beat until the reveal]' },
    { name: '极简倒计时', direction: 'Minimal countdown architecture using repeated single-note pulses, strategic silence and one powerful impact.', section: '[Instrumental - single-note countdown pulses and strategic silence lead to one powerful impact]' },
    { name: '未来律动', direction: 'Groove-led futuristic cue with offbeat plucks, elastic pulse bass and a contrasting filtered middle section.', section: '[Instrumental - offbeat plucks and elastic bass establish a futuristic groove with filtered contrast]' },
  ],
}

const fallbackVariants = compositionVariants.midnight
const harmonicDirections = [
  'Use a descending progression with changing chord inversions.',
  'Hold a tonic pedal while the upper chords shift above it.',
  'Use modal interchange and one unexpected chromatic-mediant turn.',
  'Use suspended harmony with delayed resolution and a moving bass line.',
  'Alternate a compact two-chord cell before a contrasting bridge progression.',
  'Use through-composed harmonic motion instead of a repeating four-chord loop.',
]

const API_BASE = '/ace-step'
const POLL_INTERVAL = 2_000
const GENERATION_TIMEOUT = 10 * 60_000

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

function heartArtMessage(message: string | undefined, fallback = '') {
  return (message || fallback)
    .replace(/GVM\s*Gen/gi, 'HeartArt')
    .replace(/ACE[\s-]*Step(?:\s*1\.5)?/gi, 'HeartArt')
}

async function readEnvelope<T>(response: Response) {
  let payload: ApiEnvelope<T> | undefined
  try {
    payload = await response.json() as ApiEnvelope<T>
  } catch {
    throw new Error(`HeartArt 返回了无法解析的响应（HTTP ${response.status}）`)
  }

  if (!response.ok || payload.code !== 200 || payload.error) {
    throw new Error(heartArtMessage(payload.error ?? undefined, `HeartArt 请求失败（HTTP ${response.status}）`))
  }

  return payload.data
}

async function postJson<T>(path: string, body: unknown, timeout = 30_000) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  return readEnvelope<T>(response)
}

function selectCompositionVariant(options: AceStepOptions) {
  const variants = compositionVariants[options.presetId] ?? fallbackVariants
  const index = Math.abs(Math.round(options.variation)) % variants.length
  const variant = variants[index]
  return {
    ...variant,
    direction: `${variant.direction} ${harmonicDirections[index % harmonicDirections.length]}`,
  }
}

function buildPrompt(options: AceStepOptions, variant: CompositionVariant) {
  const emotionalArc = [...options.moods]
    .sort((left, right) => left.time - right.time)
    .map((point) => `${point.time}s ${point.intensity}% energy`)
    .join(', ')

  const compositionDirection = `New composition approach: ${variant.direction}`
  const userDirection = `Creative direction: ${options.style.slice(0, 80)}`
  const energyDirection = `Energy: ${emotionalArc}`
  const reservedLength = compositionDirection.length + userDirection.length + energyDirection.length + 3
  const productionPrompt = options.productionPrompt.slice(0, Math.max(120, 512 - reservedLength)).trim()
  return `${productionPrompt} ${compositionDirection} ${userDirection} ${energyDirection}`.slice(0, 512)
}

function buildInstrumentalStructure(base: string, variant: CompositionVariant) {
  const outroPosition = base.lastIndexOf('\n[Outro')
  if (outroPosition < 0) return `${base}\n${variant.section}`
  return `${base.slice(0, outroPosition)}\n${variant.section}${base.slice(outroPosition)}`
}

function parseGeneratedFiles(value: TaskResult['result']) {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as Array<GeneratedFile> : []
  } catch {
    return []
  }
}

function proxiedAudioUrl(file: string) {
  if (file.startsWith('http://') || file.startsWith('https://')) {
    const url = new URL(file)
    return `${API_BASE}${url.pathname}${url.search}`
  }
  return `${API_BASE}${file.startsWith('/') ? '' : '/'}${file}`
}

export async function checkAceStepHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5_000) })
    const data = await readEnvelope<{ status?: string }>(response)
    return data.status === 'ok'
  } catch {
    return false
  }
}

export async function generateAceStepSoundtrack(options: AceStepOptions): Promise<AceStepSoundtrack> {
  const duration = Math.max(10, Math.min(180, Math.round(options.duration || 60)))
  const variant = selectCompositionVariant(options)
  options.onStatus?.(`正在向 HeartArt 提交「${variant.name}」编曲…`)

  const created = await postJson<{ task_id: string }>('/release_task', {
    task_type: 'text2music',
    prompt: buildPrompt(options, variant),
    lyrics: options.instrumental ? buildInstrumentalStructure(options.instrumentalStructure, variant) : '',
    instrumental: options.instrumental,
    thinking: false,
    model: 'acestep-v15-turbo',
    audio_format: 'wav',
    bpm: options.bpm,
    key_scale: options.musicKey,
    time_signature: '4',
    audio_duration: duration,
    inference_steps: 8,
    batch_size: 1,
    use_random_seed: true,
  })

  if (!created.task_id) throw new Error('HeartArt 没有返回任务编号')

  const startedAt = Date.now()
  while (Date.now() - startedAt < GENERATION_TIMEOUT) {
    await sleep(POLL_INTERVAL)
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1_000))
    options.onStatus?.(`HeartArt 正在生成真实音频 · ${elapsed}s`)

    let tasks: Array<TaskResult>
    try {
      tasks = await postJson<Array<TaskResult>>('/query_result', {
        task_id_list: [created.task_id],
      }, 10_000)
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        continue
      }
      throw error
    }
    const task = tasks.find((item) => item.task_id === created.task_id) ?? tasks[0]
    if (!task || task.status === 0) continue
    if (task.status === 2) {
      throw new Error(heartArtMessage(task.error || task.message, 'HeartArt 音乐生成失败'))
    }

    const files = parseGeneratedFiles(task.result)
    const generated = files.find((item) => item.status === 1 && item.file) ?? files.find((item) => item.file)
    if (!generated?.file) throw new Error('HeartArt 已完成任务，但没有返回音频文件')

    options.onStatus?.('正在读取 HeartArt 生成的 WAV…')
    const audioResponse = await fetch(proxiedAudioUrl(generated.file))
    if (!audioResponse.ok) throw new Error(`无法读取 HeartArt 音频（HTTP ${audioResponse.status}）`)
    const audio = await audioResponse.blob()
    if (!audio.size) throw new Error('HeartArt 返回了空音频')

    return {
      audio,
      taskId: created.task_id,
      seed: generated.seed_value || '',
      model: generated.dit_model || 'acestep-v15-turbo',
      duration: Number(generated.metas?.duration) || duration,
      variationName: variant.name,
      sourceFile: generated.file,
    }
  }

  throw new Error('HeartArt 生成超时，请稍后重试')
}

export async function repaintAceStepSoundtrack(options: AceStepRepaintOptions): Promise<AceStepSoundtrack> {
  const duration = Math.max(10, Math.min(180, Math.round(options.duration || 60)))
  const start = Math.max(0, Math.min(duration - 1, Number(options.start) || 0))
  const end = Math.max(start + 0.5, Math.min(duration, Number(options.end) || duration))
  const strength = Math.max(0.05, Math.min(1, Number(options.strength) || 0.65))
  options.onStatus?.(`正在局部重绘 ${Math.round(start)}s–${Math.round(end)}s…`)

  const created = await postJson<{ task_id: string }>('/release_task', {
    task_type: 'repaint',
    prompt: `Preserve the original music outside the selected range. Inside ${start.toFixed(1)}s to ${end.toFixed(1)}s, apply this edit: ${options.prompt.slice(0, 800)}`,
    lyrics: '[Instrumental]',
    instrumental: true,
    vocal_language: 'unknown',
    source_file: options.sourceFile,
    bpm: options.bpm,
    key_scale: options.musicKey,
    audio_duration: duration,
    repainting_start: start,
    repainting_end: end,
    repaint_mode: 'balanced',
    repaint_strength: strength,
    repaint_latent_crossfade_frames: 12,
    repaint_wav_crossfade_sec: 0.2,
    inference_steps: 8,
    batch_size: 1,
    use_random_seed: true,
  })

  if (!created.task_id) throw new Error('HeartArt 没有返回局部重绘任务编号')

  const startedAt = Date.now()
  while (Date.now() - startedAt < GENERATION_TIMEOUT) {
    await sleep(POLL_INTERVAL)
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1_000))
    options.onStatus?.(`HeartArt 正在合成局部修改版本 · ${elapsed}s`)

    let tasks: Array<TaskResult>
    try {
      tasks = await postJson<Array<TaskResult>>('/query_result', { task_id_list: [created.task_id] }, 10_000)
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) continue
      throw error
    }

    const task = tasks.find((item) => item.task_id === created.task_id) ?? tasks[0]
    if (!task || task.status === 0) continue
    if (task.status === 2) throw new Error(heartArtMessage(task.error || task.message, 'HeartArt 局部重绘失败'))

    const files = parseGeneratedFiles(task.result)
    const generated = files.find((item) => item.status === 1 && item.file) ?? files.find((item) => item.file)
    if (!generated?.file) throw new Error('HeartArt 已完成局部重绘，但没有返回音频文件')

    options.onStatus?.('正在读取局部修改后的 WAV…')
    const audioResponse = await fetch(proxiedAudioUrl(generated.file))
    if (!audioResponse.ok) throw new Error(`无法读取局部重绘音频（HTTP ${audioResponse.status}）`)
    const audio = await audioResponse.blob()
    if (!audio.size) throw new Error('HeartArt 返回了空的局部重绘音频')

    return {
      audio,
      taskId: created.task_id,
      seed: generated.seed_value || '',
      model: generated.dit_model || 'acestep-v15-turbo',
      duration: Number(generated.metas?.duration) || duration,
      variationName: `局部重绘 ${Math.round(start)}s–${Math.round(end)}s`,
      sourceFile: generated.file,
    }
  }

  throw new Error('HeartArt 局部重绘超时，请稍后重试')
}
