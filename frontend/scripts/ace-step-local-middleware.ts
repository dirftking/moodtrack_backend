import type { IncomingMessage, ServerResponse } from 'node:http'
import { copyFile, readFile, realpath, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Plugin } from 'vite'
import {
  analyzeEmotionContext,
  emotionLabel,
  isEmotionId,
  type EmotionAnalysis,
  type EmotionContextInput,
  type EmotionId,
} from '../shared/emotions'

const DEFAULT_LOCAL_API_URL = 'http://127.0.0.1:8001'
const DEFAULT_MODEL = 'acestep-v15-turbo'
const MAX_BODY_BYTES = 256 * 1024
const MAX_REFERENCE_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_ACTIVE_TASKS = 2
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000
const MAX_TASKS_PER_WINDOW = 6
const TASK_RETENTION_MS = 2 * 60 * 60 * 1_000

type AceStepLocalOptions = {
  apiUrl?: string
  model?: string
  referenceRoot?: string
  audioRoot?: string
}

type TaskStatus = 0 | 1 | 2

type LocalTask = {
  id: string
  owner: string
  status: TaskStatus
  upstreamTaskId?: string
  error?: string
  generation: SanitizedGeneration
  reference?: LoadedReference
  stagedPaths: string[]
  outputFile?: string
  outputDigest?: string
  outputDuration?: number
  createdAt: number
  updatedAt: number
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
  sourceFile?: string
  sourceTaskId?: string
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
}

type LoadedReference = {
  id: string
  emotionId: EmotionId
  labelZh: string
  labelEn: string
  format: string
  path: string
  modifiedAt: number
}

class LocalApiError extends Error {
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

function countMatches(value: string, expression: RegExp) {
  return value.match(expression)?.length || 0
}

function lyricsMeetLanguageAndLength(lyrics: string, language: string, duration: number) {
  const content = lyrics.replace(/\[[^\]\r\n]{1,120}\]/g, ' ').replace(/\s+/g, ' ').trim()
  const han = countMatches(content, /\p{Script=Han}/gu)
  const latin = countMatches(content, /\p{Script=Latin}/gu)
  const kana = countMatches(content, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu)
  const hangul = countMatches(content, /\p{Script=Hangul}/gu)
  const otherForeign = countMatches(content, /[\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Thai}]/gu)

  if (language === 'zh') {
    const maximum = Math.max(70, Math.round(duration * 4.5))
    return han >= Math.min(20, Math.round(duration))
      && han <= maximum
      && han / Math.max(1, han + latin) >= 0.6
      && kana + hangul + otherForeign === 0
  }
  if (language === 'en') {
    const words = content.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length || 0
    return words >= Math.min(12, Math.round(duration * 0.6))
      && words <= Math.max(40, Math.round(duration * 2.7))
      && han + kana + hangul + otherForeign === 0
  }
  if (language === 'ja') {
    const japanese = han + kana
    return japanese >= Math.min(20, Math.round(duration))
      && japanese <= Math.max(80, Math.round(duration * 5))
      && hangul + otherForeign === 0
  }
  if (language === 'ko') {
    return hangul >= Math.min(20, Math.round(duration))
      && hangul <= Math.max(80, Math.round(duration * 5))
      && han + kana + otherForeign === 0
  }
  return content.length >= 20 && content.length <= Math.max(120, Math.round(duration * 8))
}

const lyricSectionPattern = /^\s*\[\s*(Intro|Verse|Pre-Chorus|Chorus|Post-Chorus|Bridge|Hook|Refrain|Outro|Interlude|Instrumental Break|Breakdown|Drop|Spoken)(?:\s+(\d+))?(?:\s*[-:].*)?\]\s*$/i
const lyricPunctuationPattern = /[\s,.'’!?;:()\-—…，。！？、；：（）]/u
const commonTraditionalToSimplified: Record<string, string> = {
  著: '着', 臺: '台', 裏: '里', 裡: '里', 麼: '么', 為: '为', 與: '与', 這: '这', 個: '个', 們: '们',
  說: '说', 聽: '听', 見: '见', 風: '风', 雲: '云', 燈: '灯', 門: '门', 開: '开', 關: '关', 時: '时',
  間: '间', 聲: '声', 愛: '爱', 夢: '梦', 遠: '远', 過: '过', 還: '还', 會: '会', 無: '无', 從: '从',
  點: '点', 東: '东', 車: '车', 邊: '边', 讓: '让', 歸: '归', 溫: '温', 體: '体', 記: '记', 憶: '忆',
  萬: '万', 長: '长', 頭: '头', 來: '来', 線: '线', 樂: '乐', 氣: '气', 發: '发', 後: '后', 麗: '丽',
  續: '续', 繼: '继', 變: '变', 對: '对', 難: '难', 飛: '飞', 願: '愿', 寫: '写', 尋: '寻', 轉: '转', 滿: '满',
}

function localizedCharacter(character: string, language: string) {
  if (language === 'zh') return /\p{Script=Han}/u.test(character)
  if (language === 'ja') return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)
  if (language === 'ko') return /\p{Script=Hangul}/u.test(character)
  return /\p{Script=Latin}/u.test(character)
}

function maximumLyricUnits(language: string, duration: number) {
  if (language === 'zh') return Math.max(70, Math.round(duration * 4.5))
  if (language === 'en') return Math.max(40, Math.round(duration * 2.7))
  if (language === 'ja' || language === 'ko') return Math.max(80, Math.round(duration * 5))
  return Math.max(120, Math.round(duration * 8))
}

function normalizeGeneratedLyrics(rawLyrics: string, language: string, duration: number) {
  const output: string[] = []
  const maximum = maximumLyricUnits(language, duration)
  let units = 0
  let hasSection = false
  let pendingSection = ''

  for (const rawLine of rawLyrics.replace(/\r/g, '').split('\n')) {
    const section = rawLine.match(lyricSectionPattern)
    if (section) {
      const tag = `[${section[1]}${section[2] ? ` ${section[2]}` : ''}]`
      pendingSection = tag
      continue
    }
    if (units >= maximum) break

    if (language === 'en') {
      const words = rawLine.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []
      if (words.length > 0) {
        if (units + words.length > maximum) break
        if (pendingSection && output.at(-1) !== pendingSection) {
          output.push(pendingSection)
          hasSection = true
        }
        pendingSection = ''
        output.push(words.join(' '))
        units += words.length
      }
      continue
    }

    let cleaned = ''
    let lineUnits = 0
    for (const character of [...rawLine]) {
      if (localizedCharacter(character, language)) {
        cleaned += language === 'zh' ? (commonTraditionalToSimplified[character] || character) : character
        lineUnits += 1
      } else if (lyricPunctuationPattern.test(character)) {
        cleaned += character
      }
    }
    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.'’!?;:()\-—…，。！？、；：（）]+|[\s,.'’!?;:()\-—…，。！？、；：（）]+$/gu, '')
      .trim()
    if (cleaned && lineUnits > 0) {
      if (units + lineUnits > maximum) break
      if (pendingSection && output.at(-1) !== pendingSection) {
        output.push(pendingSection)
        hasSection = true
      }
      pendingSection = ''
      output.push(cleaned)
      units += lineUnits
    }
  }

  const normalized = `${hasSection ? '' : '[Verse]\n'}${output.join('\n')}`
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const hasChorusLyrics = /\[Chorus(?:\s+\d+)?\]\s*\n(?!\s*\[)[^\n]*[\p{L}]/iu.test(normalized)
  return lyricsMeetLanguageAndLength(normalized, language, duration) && hasChorusLyrics ? normalized : ''
}

const acceptedLyricDigests = new Set<string>()

function rememberUniqueLyrics(lyrics: string) {
  const digest = createHash('sha256').update(lyrics, 'utf8').digest('hex')
  if (acceptedLyricDigests.has(digest)) return false
  acceptedLyricDigests.add(digest)
  if (acceptedLyricDigests.size > 500) {
    const oldest = acceptedLyricDigests.values().next().value
    if (oldest) acceptedLyricDigests.delete(oldest)
  }
  return true
}

const fallbackEmotionLines: Record<string, Record<string, string>> = {
  zh: {
    joy: '笑声随着晨光绽放', sadness: '雨声收起未完思念', tension: '心跳追着倒数前行', healing: '温柔缝合旧日伤口',
    calm: '呼吸落进安静夜色', hope: '微光指向更远地方', nostalgia: '旧日旋律轻轻回响', triumph: '我们迎着高处启航',
    mystery: '雾里藏着未知方向', anger: '鼓点推开压抑回声',
  },
  en: {
    joy: 'Morning laughter opens every window', sadness: 'Rain gathers every unfinished goodbye', tension: 'My heartbeat follows the final countdown', healing: 'Gentle light repairs the broken places',
    calm: 'Every breath settles into quiet night', hope: 'A small light leads beyond the skyline', nostalgia: 'Old melodies return across the years', triumph: 'We rise together above the skyline',
    mystery: 'Silver shadows hide an unknown road', anger: 'Heavy drums break through the silence',
  },
  ja: {
    joy: '朝の笑顔が光にひらく', sadness: '雨が残した想いを包む', tension: '鼓動が秒読みを追いかける', healing: '優しい光が傷をほどく',
    calm: '静かな夜に呼吸を重ねる', hope: '小さな光が明日を指す', nostalgia: '懐かしい歌が胸に戻る', triumph: '僕らは高い空へ進む',
    mystery: '霧の向こうに道が隠れる', anger: '強い鼓動が沈黙を破る',
  },
  ko: {
    joy: '아침의 미소가 빛처럼 피어나', sadness: '빗소리가 남은 그리움을 감싸', tension: '심장이 마지막 초를 따라가', healing: '따뜻한 빛이 오래된 상처를 안아',
    calm: '고요한 밤에 숨결을 내려놓아', hope: '작은 빛이 내일의 길을 비춰', nostalgia: '오래된 노래가 다시 돌아와', triumph: '우리는 더 높은 하늘로 올라가',
    mystery: '안개 너머에 새로운 길이 숨어', anger: '거센 박자가 침묵을 밀어내',
  },
}

const fallbackLinePools: Record<string, string[][]> = {
  zh: [
    ['夜风掠过安静街角', '月光落在回程车窗', '雨后街道映着星光', '清晨沿着天际醒来'],
    ['我把旧梦留给远方', '脚步穿过微亮长廊', '心事顺着河流远航', '回声慢慢变得明亮'],
    ['沿着微光继续启航', '让新的梦落在肩上', '穿过黑夜拥抱晴朗', '这一刻我不再彷徨'],
    ['所有等待都有回响', '前方仍有温暖灯光', '明天会有新的模样', '让这首歌陪我前往'],
    ['云层散开露出远山', '风把沉默吹成答案', '时间轻轻翻过一站', '潮汐送来新的勇敢'],
    ['我在天亮以前出发', '把未说的话写成花', '握住此刻真实想法', '让心重新找到步伐'],
  ],
  en: [
    ['Night winds cross the empty corner', 'Moonlight rests across the window', 'Rainy streets reflect the starlight', 'Morning wakes beyond the skyline'],
    ['I leave old dreams behind me', 'My footsteps cross the quiet hallway', 'Every secret follows the river', 'Distant echoes slowly become brighter'],
    ['I follow light into tomorrow', 'New dreams settle on my shoulders', 'I cross the night toward sunlight', 'This time I will not wander'],
    ['Every waiting heart finds an answer', 'Warm lights remain along the road', 'Tomorrow wears a different color', 'Let this song carry me forward'],
    ['Clouds reveal the distant mountains', 'Wind turns silence into answers', 'Time moves softly past another station', 'Tides return with quiet courage'],
    ['I leave before the morning', 'Unspoken words become new flowers', 'I hold this honest moment', 'My heart remembers how to move'],
  ],
  ja: [
    ['夜風が静かな角を抜ける', '月明かりが窓辺に宿る', '雨上がりの道が星を映す', '朝が空の向こうで目覚める'],
    ['古い夢を遠くへ放す', '足音が淡い廊下を進む', '想いは川に乗って旅立つ', '遠い響きが光に変わる'],
    ['小さな光を追って進む', '新しい夢を肩に乗せる', '長い夜を越えて朝を抱く', 'もう迷わず前を見つめる'],
    ['待った時間にも答えがある', '道の先に温かな灯り', '明日は違う色で始まる', 'この歌と一緒に歩いてく'],
    ['雲がほどけて山が見える', '風が沈黙を答えに変える', '時間が次の駅へ流れる', '潮が静かな勇気を運ぶ'],
    ['夜明けの前に歩き出す', '言えない言葉を花にする', '今の気持ちを手に抱く', '心が新しい歩幅を刻む'],
  ],
  ko: [
    ['밤바람이 조용한 골목을 지나', '달빛이 돌아가는 창에 내려', '비 갠 거리가 별빛을 비춰', '아침이 먼 하늘에서 깨어나'],
    ['오래된 꿈을 멀리 보내', '발걸음이 밝은 복도를 건너', '마음은 강을 따라 여행해', '먼 메아리가 빛으로 변해'],
    ['작은 빛을 따라 계속 나아가', '새로운 꿈을 어깨에 올려', '긴 밤을 지나 햇살을 안아', '이제는 망설이지 않고 걸어'],
    ['기다린 시간도 답을 찾아', '길 끝에는 따뜻한 불빛', '내일은 다른 색으로 시작해', '이 노래와 함께 앞으로 가'],
    ['구름이 열려 먼 산을 보여', '바람이 침묵을 답으로 바꿔', '시간이 다음 역으로 흘러', '파도가 조용한 용기를 전해'],
    ['새벽이 오기 전에 출발해', '하지 못한 말을 꽃으로 써', '지금의 진심을 두 손에 안아', '마음이 새로운 걸음을 찾아'],
  ],
}

function buildFallbackLyrics(generation: SanitizedGeneration, salt: number) {
  const language = ['zh', 'en', 'ja', 'ko'].includes(generation.vocalLanguage) ? generation.vocalLanguage : 'en'
  const pools = fallbackLinePools[language]
  const emotionId = generation.emotionAnalysis?.primary.id || generation.referenceEmotionId || 'hope'
  const seed = createHash('sha256')
    .update(`${generation.sampleQuery}:${generation.prompt}:${randomUUID()}:${salt}`)
    .digest()
  const pick = (pool: string[], offset: number) => pool[seed[offset % seed.length] % pool.length]
  const lines = [
    '[Verse]',
    pick(pools[0], 0),
    pick(pools[1], 1),
    '[Chorus]',
    fallbackEmotionLines[language][emotionId] || fallbackEmotionLines[language].hope,
    pick(pools[2], 2),
  ]
  if (generation.duration >= 30) lines.push('[Bridge]', pick(pools[3], 3), pick(pools[4], 4))
  if (generation.duration >= 50) lines.push('[Outro]', pick(pools[5], 5), pick(pools[3], 6))
  return normalizeGeneratedLyrics(lines.join('\n'), language, generation.duration)
}

function uniqueFallbackLyrics(generation: SanitizedGeneration) {
  for (let salt = 0; salt < 24; salt += 1) {
    const lyrics = buildFallbackLyrics(generation, salt)
    if (lyrics && rememberUniqueLyrics(lyrics)) return lyrics
  }
  throw new LocalApiError(500, '无法构造新的安全歌词，请重新生成')
}

function wavDurationFromBytes(bytes: Buffer) {
  if (bytes.length < 44
    || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new LocalApiError(409, '本地 ACE-Step 返回的音频不是有效 WAV 文件')
  }
  let offset = 12
  let byteRate = 0
  let dataSize = 0
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    if (dataOffset + size > bytes.length) break
    if (id === 'fmt ' && size >= 16) byteRate = bytes.readUInt32LE(dataOffset + 8)
    if (id === 'data') {
      dataSize = size
      break
    }
    offset = dataOffset + size + (size % 2)
  }
  if (byteRate <= 0 || dataSize <= 0) {
    throw new LocalApiError(409, '本地 ACE-Step 返回的 WAV 音频结构无效')
  }
  return dataSize / byteRate
}

function strictLyricInstruction(language: string, duration: number) {
  if (language === 'zh') {
    return `STRICT: Output only Simplified Chinese lyrics and English section tags. No Japanese, Korean, Arabic, Cyrillic or other languages. For ${duration} seconds, use at most ${Math.max(70, Math.round(duration * 4.5))} Chinese characters in short singable lines.`
  }
  if (language === 'en') {
    return `STRICT: Output only English lyrics and section tags. For ${duration} seconds, use at most ${Math.max(40, Math.round(duration * 2.7))} words.`
  }
  if (language === 'ja') return `STRICT: Output only Japanese lyrics and English section tags, concise enough for ${duration} seconds.`
  if (language === 'ko') return `STRICT: Output only Korean lyrics and English section tags, concise enough for ${duration} seconds.`
  return `STRICT: Keep the lyrics in one language and concise enough for ${duration} seconds.`
}

function normalizeLoopbackOrigin(value: string | undefined) {
  const url = new URL((value || DEFAULT_LOCAL_API_URL).trim())
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('ACESTEP_LOCAL_API_URL 必须指向本机 HTTP 地址')
  }
  return url.origin
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

function sessionForRequest(request: IncomingMessage, response: ServerResponse) {
  const session = String(request.headers.cookie || '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('moodtrack_session='))
    ?.slice('moodtrack_session='.length)
  if (session && /^[a-f0-9-]{36}$/i.test(session)) return session
  const created = randomUUID()
  response.setHeader('Set-Cookie', `moodtrack_session=${created}; HttpOnly; SameSite=Lax; Path=/ace-step; Max-Age=7200`)
  return created
}

function readJson(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolveBody, reject) => {
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
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        reject(new Error('INVALID_JSON'))
      }
    })
    request.on('error', reject)
  })
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

function extractAudioPath(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('局部修改需要选择一段已经生成的源音频')

  try {
    const url = new URL(raw, 'http://moodtrack.local')
    if (url.pathname !== '/v1/audio') throw new Error('INVALID_SOURCE')
    const audioPath = url.searchParams.get('path') || ''
    if (!audioPath) throw new Error('INVALID_SOURCE')
    return audioPath
  } catch {
    throw new Error('源音频地址无效或已经过期')
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
    generation.sourceFile = extractAudioPath(body.source_file)
    const sourceTaskId = String(body.source_task_id || '')
    if (!/^[a-f0-9-]{36}$/i.test(sourceTaskId)) throw new Error('局部重绘的源任务编号无效')
    generation.sourceTaskId = sourceTaskId
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

function localErrorMessage(payload: unknown, status: number) {
  const record = asRecord(payload)
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  if (typeof record.detail === 'string' && record.detail.trim()) return record.detail
  return `本地 ACE-Step 请求失败（HTTP ${status}）`
}

export function aceStepLocalMiddleware(options: AceStepLocalOptions = {}): Plugin {
  const apiUrl = normalizeLoopbackOrigin(options.apiUrl)
  const model = (options.model || DEFAULT_MODEL).trim()
  const tasks = new Map<string, LocalTask>()
  const requestHistory = new Map<string, number[]>()
  let referenceRoot = options.referenceRoot
    ? resolve(options.referenceRoot)
    : resolve(process.cwd(), 'emotion-reference-library')
  let audioRoot = options.audioRoot
    ? resolve(options.audioRoot)
    : resolve(process.cwd(), 'services', 'ACE-Step-1.5', '.cache', 'acestep', 'tmp', 'api_audio')
  const referenceCache = new Map<string, LoadedReference>()
  let manifestCache: ReferenceClipManifest[] | null = null

  async function fetchLocalEnvelope(path: string, init: RequestInit = {}, timeout = 30_000) {
    let upstream: Response
    try {
      upstream = await fetch(`${apiUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(timeout),
      })
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new LocalApiError(504, '本地 ACE-Step 响应超时')
      }
      throw new LocalApiError(503, '本地 ACE-Step 尚未启动或正在加载模型')
    }

    const text = await upstream.text()
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      throw new LocalApiError(upstream.ok ? 502 : upstream.status, `本地 ACE-Step 返回了无法解析的响应（HTTP ${upstream.status}）`)
    }
    if (!upstream.ok) throw new LocalApiError(upstream.status, localErrorMessage(payload, upstream.status))
    const envelope = asRecord(payload)
    if (typeof envelope.code === 'number' && envelope.code !== 200) {
      throw new LocalApiError(envelope.code, localErrorMessage(envelope, envelope.code))
    }
    return envelope
  }

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
      return [{ id, emotionId: clip.emotionId, file, format } satisfies ReferenceClipManifest]
    })
    return manifestCache
  }

  async function loadEmotionReference(emotionId: EmotionId | undefined) {
    if (!emotionId) return undefined
    try {
      const clip = (await loadReferenceManifest()).find((item) => item.emotionId === emotionId)
      if (!clip) return undefined
      const requestedPath = resolve(referenceRoot, clip.file)
      const canonicalRoot = await realpath(referenceRoot)
      const canonicalPath = await realpath(requestedPath)
      const relativePath = relative(canonicalRoot, canonicalPath)
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return undefined
      const fileStats = await stat(canonicalPath)
      const cached = referenceCache.get(clip.id)
      if (cached?.modifiedAt === fileStats.mtimeMs) return cached
      if (!fileStats.size || fileStats.size > MAX_REFERENCE_AUDIO_BYTES) return undefined
      if (clip.format === 'wav') {
        const signature = await readFile(canonicalPath)
        if (signature.subarray(0, 4).toString('ascii') !== 'RIFF' || signature.subarray(8, 12).toString('ascii') !== 'WAVE') return undefined
      }
      const labels = emotionLabel(emotionId)
      const loaded: LoadedReference = {
        id: clip.id,
        emotionId,
        labelZh: labels.labelZh,
        labelEn: labels.labelEn,
        format: clip.format,
        path: canonicalPath,
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

  async function safeLocalAudioPath(value: string) {
    if (!isAbsolute(value) || !/\.(wav|wav32|mp3|flac|opus|ogg|aac|m4a)$/i.test(extname(value))) {
      throw new LocalApiError(400, '源音频地址无效')
    }
    let canonicalRoot: string
    let canonicalPath: string
    try {
      [canonicalRoot, canonicalPath] = await Promise.all([realpath(audioRoot), realpath(value)])
    } catch {
      throw new LocalApiError(410, '源音频已经过期，请先重新生成音乐')
    }
    const relativePath = relative(canonicalRoot, canonicalPath)
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new LocalApiError(400, '源音频地址无效')
    }
    return canonicalPath
  }

  async function stageAudio(sourcePath: string, prefix: string) {
    const extension = extname(sourcePath).toLowerCase()
    if (!/^\.(wav|wav32|mp3|flac|opus|ogg|aac|m4a)$/.test(extension)) {
      throw new LocalApiError(400, '音频格式不受支持')
    }
    const stagedPath = join(tmpdir(), `${prefix}-${randomUUID()}${extension}`)
    await copyFile(sourcePath, stagedPath)
    return stagedPath
  }

  function scheduleStagedCleanup(paths: string[]) {
    if (!paths.length) return
    const timer = setTimeout(() => {
      for (const path of paths) void unlink(path).catch(() => undefined)
    }, 60 * 60 * 1_000)
    timer.unref()
  }

  function pruneExpired() {
    const cutoff = Date.now() - TASK_RETENTION_MS
    for (const [id, task] of tasks) {
      if (task.updatedAt < cutoff) tasks.delete(id)
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
      throw new LocalApiError(429, '本机已有音乐正在生成，请等待前面的任务完成')
    }
    const client = clientAddress(request)
    const now = Date.now()
    const recent = (requestHistory.get(client) || [])
      .filter((timestamp) => timestamp >= now - RATE_LIMIT_WINDOW_MS)
    if (recent.length >= MAX_TASKS_PER_WINDOW) {
      throw new LocalApiError(429, '生成请求过于频繁，请稍后再试')
    }
    recent.push(now)
    requestHistory.set(client, recent)
  }

  async function prepareLocalGeneration(generation: SanitizedGeneration) {
    if (!generation.sampleMode) return generation
    for (let attempt = 1; attempt <= 1; attempt += 1) {
      const sample = await fetchLocalEnvelope('/v1/create_sample', {
        method: 'POST',
        body: JSON.stringify({
          query: `${generation.sampleQuery}\n${strictLyricInstruction(generation.vocalLanguage, generation.duration)}\nRewrite from scratch on retry ${attempt}; never repeat an earlier invalid draft.`,
          instrumental: false,
          vocal_language: generation.vocalLanguage,
          temperature: 0.9 + attempt * 0.04,
        }),
      }, 180_000)
      const data = asRecord(sample.data)
      const lyrics = String(data.lyrics || '').trim()
      if (!lyrics || /^\[Instrumental\]$/i.test(lyrics)) continue
      const normalizedLyrics = normalizeGeneratedLyrics(lyrics, generation.vocalLanguage, generation.duration)
      if (!normalizedLyrics) continue
      if (!rememberUniqueLyrics(normalizedLyrics)) continue
      return {
        ...generation,
        lyrics: normalizedLyrics,
        sampleMode: false,
        sampleQuery: '',
      }
    }
    return {
      ...generation,
      lyrics: uniqueFallbackLyrics(generation),
      sampleMode: false,
      sampleQuery: '',
    }
  }

  async function buildLocalPayload(inputGeneration: SanitizedGeneration) {
    const generation = await prepareLocalGeneration(inputGeneration)
    // MoodTrack intentionally uses text-only emotion conditioning. Repaint source
    // audio is staged below, but emotion Reference Audio must never reach ACE.
    const reference: LoadedReference | undefined = undefined
    const stagedPaths: string[] = []
    const payload: Record<string, unknown> = {
      task_type: generation.taskType,
      prompt: generation.prompt,
      lyrics: generation.lyrics,
      sample_mode: generation.sampleMode,
      sample_query: generation.sampleQuery,
      instrumental: generation.instrumental,
      vocal_language: generation.vocalLanguage,
      // Use the already-loaded 1.7B 5Hz LM for semantic audio codes on full
      // generations. Keep caption/language rewriting disabled so the user's
      // prompt, lyrics and explicit metadata remain authoritative.
      thinking: generation.taskType === 'text2music',
      use_format: false,
      use_cot_caption: false,
      use_cot_language: false,
      model,
      audio_format: 'wav',
      bpm: generation.bpm,
      key_scale: generation.keyScale,
      time_signature: generation.timeSignature,
      audio_duration: generation.duration,
      inference_steps: 8,
      batch_size: 1,
      use_random_seed: true,
    }
    if (generation.taskType === 'repaint') {
      payload.sample_mode = false
      payload.sample_query = ''
      payload.thinking = false
      payload.use_cot_caption = false
      payload.use_cot_language = false
      const sourcePath = await safeLocalAudioPath(generation.sourceFile || '')
      const stagedSource = await stageAudio(sourcePath, 'moodtrack-repaint')
      stagedPaths.push(stagedSource)
      payload.src_audio_path = stagedSource
      payload.repainting_start = generation.repaintingStart
      payload.repainting_end = generation.repaintingEnd
      payload.repaint_mode = 'balanced'
      payload.repaint_strength = generation.repaintStrength
      payload.repaint_latent_crossfade_frames = 12
      payload.repaint_wav_crossfade_sec = 0.2
    }
    return { payload, reference, stagedPaths, generation }
  }

  async function decorateTaskResult(item: unknown, tracked: LocalTask) {
    const result = asRecord(item)
    const status = Number(result.status)
    if ([0, 1, 2].includes(status)) {
      tracked.status = status as TaskStatus
      tracked.updatedAt = Date.now()
    }
    const publicResult = { ...result, task_id: tracked.id }
    if (status !== 1 || typeof result.result !== 'string') return publicResult

    let parsed: unknown
    try {
      parsed = JSON.parse(result.result) as unknown
    } catch {
      return publicResult
    }
    if (!Array.isArray(parsed)) return publicResult
    const files = []
    for (const value of parsed) {
      const file = asRecord(value)
      if (!tracked.outputFile && typeof file.file === 'string') {
        const outputFile = extractAudioPath(file.file)
        const safeOutput = await safeLocalAudioPath(outputFile)
        const outputStats = await stat(safeOutput)
        if (outputStats.size < 44 || outputStats.mtimeMs < tracked.createdAt - 10_000) {
          throw new LocalApiError(409, '本地 ACE-Step 返回了过期或无效的音频文件')
        }
        const reusedBy = [...tasks.values()].find((task) => (
          task.id !== tracked.id && task.owner === tracked.owner && task.outputFile === outputFile
        ))
        if (reusedBy) throw new LocalApiError(409, '本地 ACE-Step 复用了旧音频路径，已阻止覆盖')
        tracked.outputFile = outputFile
      }
      if (tracked.outputFile && !tracked.outputDigest) {
        const safeOutput = await safeLocalAudioPath(tracked.outputFile)
        const bytes = await readFile(safeOutput)
        const outputDuration = wavDurationFromBytes(bytes)
        const tolerance = Math.max(1.5, tracked.generation.duration * 0.08)
        if (Math.abs(outputDuration - tracked.generation.duration) > tolerance) {
          throw new LocalApiError(409, `本地 ACE-Step 音频时长校验失败（期望 ${tracked.generation.duration}s，实际 ${outputDuration.toFixed(1)}s）`)
        }
        const digest = createHash('sha256').update(bytes).digest('hex')
        const duplicate = [...tasks.values()].find((task) => (
          task.id !== tracked.id && task.owner === tracked.owner && task.outputDigest === digest
        ))
        if (duplicate) throw new LocalApiError(409, '本地 ACE-Step 返回了旧音频内容，已阻止覆盖')
        tracked.outputDigest = digest
        tracked.outputDuration = outputDuration
      }
      const sourceLyrics = tracked.generation.lyrics
      const lyrics = sourceLyrics || String(file.lyrics || '')
      files.push({
        ...file,
        lyrics,
        emotion_analysis: tracked.generation.emotionAnalysis,
        reference_audio: null,
        moodtrack_audio_digest: tracked.outputDigest,
        moodtrack_audio_duration: tracked.outputDuration,
      })
    }
    return { ...publicResult, result: JSON.stringify(files) }
  }

  async function submitLocalTask(taskId: string) {
    const tracked = tasks.get(taskId)
    if (!tracked) return
    let localRequest: Awaited<ReturnType<typeof buildLocalPayload>> | undefined
    try {
      localRequest = await buildLocalPayload(tracked.generation)
      tracked.generation = localRequest.generation
      tracked.reference = localRequest.reference
      tracked.stagedPaths = localRequest.stagedPaths
      tracked.updatedAt = Date.now()
      const upstream = await fetchLocalEnvelope('/release_task', {
        method: 'POST',
        body: JSON.stringify(localRequest.payload),
      }, 30_000)
      const data = asRecord(upstream.data)
      const upstreamTaskId = String(data.task_id || '')
      if (!/^[a-f0-9-]{36}$/i.test(upstreamTaskId)) {
        throw new LocalApiError(502, '本地 ACE-Step 没有返回有效的任务编号')
      }
      if ([...tasks.values()].some((task) => task.id !== taskId && task.upstreamTaskId === upstreamTaskId)) {
        throw new LocalApiError(502, '本地 ACE-Step 返回了重复任务编号，已拒绝旧结果')
      }
      tracked.upstreamTaskId = upstreamTaskId
      tracked.updatedAt = Date.now()
      scheduleStagedCleanup(localRequest.stagedPaths)
    } catch (error) {
      for (const path of localRequest?.stagedPaths || []) void unlink(path).catch(() => undefined)
      tracked.status = 2
      tracked.error = error instanceof Error ? error.message : '本地 ACE-Step 任务提交失败'
      tracked.updatedAt = Date.now()
    }
  }

  async function proxyLocalAudio(response: ServerResponse, audioPath: string, tracked: LocalTask) {
    const safePath = await safeLocalAudioPath(audioPath)
    const trackedPath = tracked.outputFile ? await safeLocalAudioPath(tracked.outputFile) : ''
    if (!trackedPath || safePath !== trackedPath) {
      throw new LocalApiError(409, '音频文件与当前任务不匹配，已阻止读取旧结果')
    }
    let upstream: Response
    try {
      upstream = await fetch(`${apiUrl}/v1/audio?path=${encodeURIComponent(safePath)}`, {
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new LocalApiError(503, '无法读取本地 ACE-Step 音频')
    }
    const bytes = Buffer.from(await upstream.arrayBuffer())
    if (!upstream.ok) throw new LocalApiError(upstream.status, `无法读取本地 ACE-Step 音频（HTTP ${upstream.status}）`)
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (!tracked.outputDigest || digest !== tracked.outputDigest) {
      throw new LocalApiError(409, '音频文件在任务完成后发生变化，已阻止读取')
    }
    const duplicate = [...tasks.values()].find((task) => (
      task.id !== tracked.id && task.owner === tracked.owner && task.outputDigest === digest
    ))
    if (duplicate) throw new LocalApiError(409, '本地 ACE-Step 返回了旧音频内容，已阻止覆盖')
    tracked.outputDigest = digest
    response.statusCode = 200
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/wav')
    response.setHeader('Content-Length', String(bytes.length))
    response.setHeader('Cache-Control', 'no-store, max-age=0')
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('Expires', '0')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.end(bytes)
  }

  return {
    name: 'moodtrack-ace-step-local-proxy',
    configureServer(server) {
      if (!options.referenceRoot) referenceRoot = resolve(server.config.root, 'emotion-reference-library')
      if (!options.audioRoot) {
        audioRoot = resolve(server.config.root, 'services', 'ACE-Step-1.5', '.cache', 'acestep', 'tmp', 'api_audio')
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
            const upstream = await fetchLocalEnvelope('/health', {}, 8_000)
            const upstreamData = asRecord(upstream.data)
            if (upstreamData.status && upstreamData.status !== 'ok') {
              throw new LocalApiError(503, '本地 ACE-Step 尚未准备完成')
            }
            if (upstreamData.models_initialized === false) {
              throw new LocalApiError(503, '本地 ACE-Step 正在加载音乐模型')
            }
            if (upstreamData.llm_initialized === false) {
              throw new LocalApiError(503, '本地 ACE-Step 正在加载歌词模型')
            }
            sendEnvelope(response, {
              ...upstreamData,
              status: 'ok',
              service: 'ACE-Step Local API',
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
            sendEnvelope(response, { ...analysis, reference: null })
            return
          }

          if (request.method === 'POST' && url.pathname === '/release_task') {
            const owner = sessionForRequest(request, response)
            const generation = sanitizeGeneration(await readJson(request))
            if (generation.taskType === 'repaint') {
              const sourceTask = tasks.get(generation.sourceTaskId || '')
              if (!sourceTask || sourceTask.owner !== owner || sourceTask.status !== 1 || !sourceTask.outputFile) {
                throw new LocalApiError(409, '局部重绘源版本未完成或已过期，请先重新生成完整版本')
              }
              if (sourceTask.outputFile !== generation.sourceFile) {
                throw new LocalApiError(409, '局部重绘源音频与所选版本不匹配，已阻止串用旧版本')
              }
            }
            acceptGenerationRequest(request)
            const taskId = randomUUID()
            tasks.set(taskId, {
              id: taskId,
              owner,
              status: 0,
              generation,
              stagedPaths: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
            void submitLocalTask(taskId)
            sendEnvelope(response, { task_id: taskId, status: 'queued', queue_position: 1 })
            return
          }

          if (request.method === 'POST' && url.pathname === '/query_result') {
            const owner = sessionForRequest(request, response)
            const taskId = sanitizeQuery(await readJson(request))
            const tracked = tasks.get(taskId)
            if (!tracked || tracked.owner !== owner) throw new LocalApiError(404, '任务不属于当前 MoodTrack 生成会话')
            if (tracked.status === 2 && !tracked.upstreamTaskId) {
              sendEnvelope(response, [{ task_id: taskId, status: 2, error: tracked.error || '本地 ACE-Step 任务失败' }])
              return
            }
            if (!tracked.upstreamTaskId) {
              sendEnvelope(response, [{ task_id: taskId, status: 0 }])
              return
            }
            const upstream = await fetchLocalEnvelope('/query_result', {
              method: 'POST',
              body: JSON.stringify({ task_id_list: [tracked.upstreamTaskId] }),
            }, 12_000)
            const data = Array.isArray(upstream.data)
              ? await Promise.all(upstream.data.map((item) => decorateTaskResult(item, tracked)))
              : []
            sendEnvelope(response, data)
            return
          }

          if (request.method === 'GET' && url.pathname === '/v1/audio') {
            const owner = sessionForRequest(request, response)
            const taskId = String(url.searchParams.get('moodtrack_task') || '')
            const tracked = tasks.get(taskId)
            if (!/^[a-f0-9-]{36}$/i.test(taskId) || !tracked || tracked.owner !== owner || tracked.status !== 1) {
              throw new LocalApiError(404, '音频任务不属于当前 MoodTrack 生成会话')
            }
            await proxyLocalAudio(response, url.searchParams.get('path') || '', tracked)
            return
          }

          sendError(response, 404, '不支持的 ACE-Step 操作')
        } catch (error) {
          if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
            sendError(response, 413, '请求内容过大')
          } else if (error instanceof Error && error.message === 'INVALID_JSON') {
            sendError(response, 400, '请求格式无效')
          } else if (error instanceof LocalApiError) {
            sendError(response, error.status >= 400 && error.status < 600 ? error.status : 502, error.message)
          } else {
            sendError(response, 502, error instanceof Error ? error.message : '本地 ACE-Step 服务暂时不可用')
          }
        }
      })
    },
  }
}
