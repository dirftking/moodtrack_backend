import type { EmotionAnalysis, EmotionId, MoodPointInput } from '../shared/emotions'

type MoodPoint = MoodPointInput

export type EmotionReferenceInfo = {
  id: string
  emotionId: EmotionId
  labelZh: string
  labelEn: string
  available: boolean
}

export type EmotionAnalysisResult = EmotionAnalysis & {
  reference: EmotionReferenceInfo | null
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
  emotionDescription: string
  instrumental: boolean
  vocalStyle: string
  vocalLanguage: string
  lyrics: string
  variation: number
  excludedAudioDigests?: string[]
  onStatus?: (message: string) => void
  onLyricsGenerated?: (lyrics: string) => void
  onEmotionClassified?: (analysis: EmotionAnalysisResult) => void
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
  lyrics?: string
  caption?: string
  emotion_analysis?: EmotionAnalysis
  reference_audio?: EmotionReferenceInfo | null
  moodtrack_audio_digest?: string
  moodtrack_audio_duration?: number
  metas?: {
    duration?: number
  }
}

export function resolveGeneratedEmotionMetadata(
  generated: GeneratedFile,
  fallbackAnalysis: EmotionAnalysisResult | null | undefined,
) {
  const reference = null
  const emotionAnalysis = generated.emotion_analysis
    ? { ...generated.emotion_analysis, referenceEmotionId: null, reference }
    : fallbackAnalysis ? { ...fallbackAnalysis, referenceEmotionId: null, reference } : null
  return { emotionAnalysis, reference }
}

export type AceStepSoundtrack = {
  audioUrl: string
  taskId: string
  seed: string
  model: string
  duration: number
  variationName: string
  lyrics: string
  sourceFile: string
  emotionAnalysis: EmotionAnalysisResult | null
  reference: EmotionReferenceInfo | null
  audioDigest: string
}

export type AceStepRepaintOptions = {
  sourceTaskId: string
  sourceFile: string
  prompt: string
  lyrics: string
  instrumental: boolean
  vocalLanguage: string
  bpm: number
  musicKey: string
  duration: number
  start: number
  end: number
  strength: number
  excludedAudioDigests?: string[]
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
  freeform: [
    {
      name: '自由指令',
      direction: 'Follow the user-provided prompt as the primary creative specification. Do not introduce any scene-preset genre, instrumentation, harmony or narrative.',
      section: '',
    },
  ],
}

const fallbackVariants = compositionVariants.midnight
const API_BASE = '/ace-step'
const POLL_INTERVAL = 2_000
const GENERATION_TIMEOUT = 10 * 60_000
const MAX_GENERATION_PROMPT_LENGTH = 1_200

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

async function readEnvelope<T>(response: Response) {
  let payload: ApiEnvelope<T> | undefined
  try {
    payload = await response.json() as ApiEnvelope<T>
  } catch {
    throw new Error(`MoodTrack 返回了无法解析的响应（HTTP ${response.status}）`)
  }

  if (!response.ok || payload.code !== 200 || payload.error) {
    throw new Error(payload.error || `MoodTrack 请求失败（HTTP ${response.status}）`)
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
  return variants[index]
}

function trimPromptPart(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maximum) return normalized
  if (maximum <= 0) return ''

  const candidate = normalized.slice(0, maximum + 1)
  const sentenceBoundary = Math.max(
    candidate.lastIndexOf('. '),
    candidate.lastIndexOf('。'),
    candidate.lastIndexOf('! '),
    candidate.lastIndexOf('? '),
    candidate.lastIndexOf('; '),
  )
  if (sentenceBoundary >= Math.min(160, Math.floor(maximum * 0.6))) {
    return candidate.slice(0, sentenceBoundary + 1).trim()
  }
  const wordBoundary = candidate.lastIndexOf(' ')
  return candidate.slice(0, wordBoundary > 0 ? wordBoundary : maximum).trim()
}

function joinPromptParts(parts: string[]) {
  let prompt = ''
  for (const rawPart of parts) {
    const part = rawPart.replace(/\s+/g, ' ').trim()
    if (!part) continue
    const separator = prompt ? ' ' : ''
    const available = MAX_GENERATION_PROMPT_LENGTH - prompt.length - separator.length
    if (available <= 0) break
    const next = trimPromptPart(part, available)
    if (!next) break
    prompt += `${separator}${next}`
    if (next.length < part.length) break
  }
  return prompt
}

export function buildPrompt(options: AceStepOptions, variant: CompositionVariant, analysis?: EmotionAnalysisResult) {
  const freeform = options.presetId === 'freeform'
  const emotionalArc = [...options.moods]
    .sort((left, right) => left.time - right.time)
    .map((point) => `${point.time}s ${point.label} at ${point.intensity}% intensity`)
    .join(', ')

  const vocalDirection = options.instrumental
    ? 'Strictly instrumental. No singing, spoken word or choir.'
    : options.vocalStyle.trim()
      ? `Vocal song with a clearly audible lead singer. Vocal direction: ${options.vocalStyle.slice(0, 120)}. Keep the lead vocal intelligible and forward in the mix; sing every lyric section instead of treating the voice as ambience.`
      : 'Vocal song with a clearly audible lead singer. Follow the user prompt for vocal character and keep every lyric section intelligible and forward in the mix.'
  const productionBase = options.instrumental
    ? options.productionPrompt
    : options.productionPrompt
        .replace(/^Instrumental\s+/i, '')
        .replace(/\s*No\s+([^.]*?)(?:,?\s+or\s+vocals|,?\s+vocals)(\.)/gi, ' No $1$2')
        .trim()
  if (freeform) return joinPromptParts([vocalDirection, productionBase])

  const compositionDirection = `Arrangement variation: ${variant.direction}`
  const canonicalDirection = analysis && !analysis.fallback
    ? `Overall emotion: ${analysis.primary.labelEn}.`
    : ''
  const userEmotion = options.emotionDescription.trim()
    ? `User emotion description: ${options.emotionDescription.trim().slice(0, 260)}.`
    : ''
  const energyDirection = emotionalArc ? `Emotional arc: ${emotionalArc}.` : ''
  return joinPromptParts([
    vocalDirection,
    productionBase,
    compositionDirection,
    canonicalDirection,
    userEmotion,
    energyDirection,
  ])
}

const vocalLanguageNames: Record<string, string> = {
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
}

export function buildLyricQuery(options: AceStepOptions, variant: CompositionVariant, attempt: number, analysis?: EmotionAnalysisResult) {
  const moodArc = [...options.moods]
    .sort((left, right) => left.time - right.time)
    .map((point) => `${point.label} ${point.intensity}%`)
    .join(' -> ')
  const language = vocalLanguageNames[options.vocalLanguage] ?? 'the selected language'
  const nonce = `${options.variation}-${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 9)}`
  const agentDirection = analysis && !analysis.fallback
    ? `Text Emotion Agent category: ${analysis.summary}.`
    : 'Text Emotion Agent found no confident standard category; preserve the original wording without adding a default emotion.'
  return [
    `Write completely new, original song lyrics in ${language}.`,
    `Title concept: ${options.title}. Scene: ${options.scene}.`,
    `Music style: ${options.style}. Vocal direction: ${options.vocalStyle}.`,
    `Emotional intent: ${options.emotionDescription || moodArc}. ${agentDirection}`,
    `Emotional arc: ${moodArc}. Target song length: about ${Math.round(options.duration)} seconds.`,
    `Composition variation: ${variant.name}. Use concise, singable lines and a memorable chorus.`,
    'Use section tags such as [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Bridge], and [Outro].',
    'Do not reuse any complete line or distinctive phrase from the previous draft below. Create a different story, imagery, hook, and rhyme flow.',
    `Creative nonce: ${nonce}.`,
    `Previous draft to avoid:\n${options.lyrics.slice(0, 1_600)}`,
  ].join('\n')
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

function proxiedAudioUrl(file: string, taskId: string) {
  const cacheBust = `moodtrack_task=${encodeURIComponent(taskId)}&fresh=${Date.now()}-${Math.random().toString(36).slice(2)}`
  if (file.startsWith('http://') || file.startsWith('https://')) {
    const url = new URL(file)
    return `${API_BASE}${url.pathname}${url.search}${url.search ? '&' : '?'}${cacheBust}`
  }
  return `${API_BASE}${file.startsWith('/') ? '' : '/'}${file}${file.includes('?') ? '&' : '?'}${cacheBust}`
}

function validateServerAudioMetadata(
  generated: GeneratedFile,
  expectedDuration: number,
  excludedAudioDigests: string[] = [],
) {
  const digest = String(generated.moodtrack_audio_digest || '').toLowerCase()
  const actualDuration = Number(generated.moodtrack_audio_duration)
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error('MoodTrack 没有返回可验证的音频指纹')
  }
  if (excludedAudioDigests.some((value) => value.toLowerCase() === digest)) {
    throw new Error('MoodTrack 返回了旧音频结果，已阻止覆盖')
  }
  const tolerance = Math.max(1.5, expectedDuration * 0.08)
  if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - expectedDuration) > tolerance) {
    throw new Error(`MoodTrack 音频时长校验失败（期望 ${expectedDuration}s，实际 ${Number.isFinite(actualDuration) ? actualDuration.toFixed(1) : '未知'}s）`)
  }
  return { digest, duration: actualDuration }
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

async function classifyEmotion(options: AceStepOptions) {
  return postJson<EmotionAnalysisResult>('/emotions/classify', {
    title: options.title,
    scene: options.scene,
    style: options.style,
    description: options.emotionDescription,
    duration: options.duration,
    moods: options.moods,
  }, 10_000)
}

export async function generateAceStepSoundtrack(options: AceStepOptions): Promise<AceStepSoundtrack> {
  const duration = Math.max(10, Math.min(180, Math.round(options.duration || 60)))
  const variant = selectCompositionVariant(options)
  let generatedLyrics = options.lyrics.trim()
  let emotionAnalysis: EmotionAnalysisResult | undefined
  options.onStatus?.('Text Emotion Agent 正在归一化情绪描述…')
  try {
    emotionAnalysis = await classifyEmotion(options)
    emotionAnalysis = { ...emotionAnalysis, referenceEmotionId: null, reference: null }
    options.onEmotionClassified?.(emotionAnalysis)
    options.onStatus?.(emotionAnalysis.fallback
      ? 'Text Emotion Agent：未找到高置信度标准类别 · 保留原始描述并使用纯文本情绪引导'
      : `Text Emotion Agent：${emotionAnalysis.summary} · 使用纯文本情绪引导`)
  } catch {
    options.onStatus?.('Text Emotion Agent 暂不可用，将保留原始情绪描述继续生成')
  }
  const generationPrompt = buildPrompt(options, variant, emotionAnalysis)
  const sampleQuery = options.instrumental
    ? ''
    : `${buildLyricQuery(options, variant, 1, emotionAnalysis)}\nSound and arrangement direction:\n${generationPrompt}`
  options.onStatus?.(`正在向 MoodTrack 提交「${variant.name}」编曲…`)

  const created = await postJson<{ task_id: string }>('/release_task', {
    task_type: 'text2music',
    prompt: generationPrompt,
    lyrics: options.instrumental ? options.instrumentalStructure : '',
    sample_mode: !options.instrumental,
    sample_query: sampleQuery,
    instrumental: options.instrumental,
    vocal_language: options.instrumental ? 'unknown' : options.vocalLanguage,
    thinking: true,
    use_cot_caption: false,
    use_cot_language: false,
    model: 'acestep-v15-turbo',
    audio_format: 'wav',
    bpm: options.bpm,
    key_scale: options.musicKey,
    time_signature: '4',
    audio_duration: duration,
    inference_steps: 8,
    batch_size: 1,
    use_random_seed: true,
    emotion_context: {
      title: options.title,
      scene: options.scene,
      style: options.style,
      description: options.emotionDescription,
      duration,
      moods: options.moods,
    },
  }, 30_000)

  if (!created.task_id) throw new Error('MoodTrack 没有返回任务编号')

  const startedAt = Date.now()
  while (Date.now() - startedAt < GENERATION_TIMEOUT) {
    await sleep(POLL_INTERVAL)
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1_000))
    options.onStatus?.(`MoodTrack 正在生成真实音频 · ${elapsed}s`)

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
    const task = tasks.find((item) => item.task_id === created.task_id)
    if (!task && tasks.length) throw new Error('MoodTrack 返回了其他任务的结果，已阻止旧音频覆盖')
    if (!task || task.status === 0) continue
    if (task.status === 2) {
      throw new Error(task.error || task.message || 'MoodTrack 音乐生成失败')
    }

    const files = parseGeneratedFiles(task.result)
    const generated = files.find((item) => item.status === 1 && item.file) ?? files.find((item) => item.file)
    if (!generated?.file) throw new Error('MoodTrack 已完成任务，但没有返回音频文件')

    if (!options.instrumental && generated.lyrics?.trim()) {
      generatedLyrics = generated.lyrics.trim()
      options.onLyricsGenerated?.(generatedLyrics)
    }

    options.onStatus?.('正在校验 MoodTrack 音频指纹…')
    const validated = validateServerAudioMetadata(generated, duration, options.excludedAudioDigests)
    const metadata = resolveGeneratedEmotionMetadata(generated, emotionAnalysis)

    return {
      audioUrl: proxiedAudioUrl(generated.file, created.task_id),
      taskId: created.task_id,
      seed: generated.seed_value || '',
      model: generated.dit_model || 'acemusic/acestep-v15-turbo',
      duration: validated.duration,
      variationName: variant.name,
      lyrics: generatedLyrics,
      sourceFile: generated.file,
      emotionAnalysis: metadata.emotionAnalysis,
      reference: metadata.reference,
      audioDigest: validated.digest,
    }
  }

  throw new Error('MoodTrack 生成超时，请稍后重试')
}

export async function repaintAceStepSoundtrack(options: AceStepRepaintOptions): Promise<AceStepSoundtrack> {
  const duration = Math.max(10, Math.min(180, Math.round(options.duration || 60)))
  const start = Math.max(0, Math.min(duration - 1, Number(options.start) || 0))
  const end = Math.max(start + 0.5, Math.min(duration, Number(options.end) || duration))
  const strength = Math.max(0.05, Math.min(1, Number(options.strength) || 0.65))
  const preservedLyrics = options.instrumental ? '[Instrumental]' : options.lyrics.trim()
  if (!options.instrumental && !preservedLyrics) {
    throw new Error('人声歌曲局部重绘需要保留源版本歌词')
  }
  options.onStatus?.(`正在局部重绘 ${Math.round(start)}s–${Math.round(end)}s…`)

  const created = await postJson<{ task_id: string }>('/release_task', {
    task_type: 'repaint',
    source_task_id: options.sourceTaskId,
    prompt: `Preserve the original song outside the selected range. Inside ${start.toFixed(1)}s to ${end.toFixed(1)}s, apply this edit: ${options.prompt.slice(0, 800)}`,
    lyrics: preservedLyrics,
    instrumental: options.instrumental,
    vocal_language: options.instrumental ? 'unknown' : options.vocalLanguage,
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

  if (!created.task_id) throw new Error('MoodTrack 没有返回局部重绘任务编号')

  const startedAt = Date.now()
  while (Date.now() - startedAt < GENERATION_TIMEOUT) {
    await sleep(POLL_INTERVAL)
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1_000))
    options.onStatus?.(`MoodTrack 正在合成局部修改版本 · ${elapsed}s`)

    let tasks: Array<TaskResult>
    try {
      tasks = await postJson<Array<TaskResult>>('/query_result', {
        task_id_list: [created.task_id],
      }, 10_000)
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) continue
      throw error
    }

    const task = tasks.find((item) => item.task_id === created.task_id)
    if (!task && tasks.length) throw new Error('MoodTrack 返回了其他局部重绘任务，已阻止旧版本覆盖')
    if (!task || task.status === 0) continue
    if (task.status === 2) throw new Error(task.error || task.message || 'MoodTrack 局部重绘失败')

    const files = parseGeneratedFiles(task.result)
    const generated = files.find((item) => item.status === 1 && item.file) ?? files.find((item) => item.file)
    if (!generated?.file) throw new Error('MoodTrack 已完成局部重绘，但没有返回音频文件')

    options.onStatus?.('正在校验局部修改音频指纹…')
    const validated = validateServerAudioMetadata(generated, duration, options.excludedAudioDigests)

    return {
      audioUrl: proxiedAudioUrl(generated.file, created.task_id),
      taskId: created.task_id,
      seed: generated.seed_value || '',
      model: generated.dit_model || 'acemusic/acestep-v15-turbo',
      duration: validated.duration,
      variationName: `局部重绘 ${Math.round(start)}s–${Math.round(end)}s`,
      lyrics: preservedLyrics,
      sourceFile: generated.file,
      emotionAnalysis: generated.emotion_analysis
        ? { ...generated.emotion_analysis, reference: null }
        : null,
      reference: null,
      audioDigest: validated.digest,
    }
  }

  throw new Error('MoodTrack 局部重绘超时，请稍后重试')
}
