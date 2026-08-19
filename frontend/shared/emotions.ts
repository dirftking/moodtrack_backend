export const emotionIds = [
  'joy',
  'sadness',
  'tension',
  'healing',
  'calm',
  'hope',
  'nostalgia',
  'triumph',
  'mystery',
  'anger',
] as const

export type EmotionId = typeof emotionIds[number]

export type MoodPointInput = {
  label: string
  time: number
  intensity: number
}

export type EmotionContextInput = {
  title: string
  scene: string
  style: string
  description: string
  duration: number
  moods: MoodPointInput[]
}

export type EmotionMatch = {
  id: EmotionId
  labelZh: string
  labelEn: string
  promptTags: string[]
  confidence: number
  matchedTerms: string[]
}

export type EmotionNodeAnalysis = {
  raw: string
  primary: EmotionMatch
  secondary?: EmotionMatch
  fallback: boolean
}

export type EmotionAnalysis = {
  agent: 'moodtrack-text-agent-v1'
  primary: EmotionMatch
  secondary?: EmotionMatch
  nodes: EmotionNodeAnalysis[]
  referenceEmotionId: EmotionId | null
  fallback: boolean
  summary: string
}

type EmotionDefinition = {
  id: EmotionId
  labelZh: string
  labelEn: string
  promptTags: string[]
  aliases: string[]
}

export const emotionTaxonomy: readonly EmotionDefinition[] = [
  {
    id: 'joy',
    labelZh: '开心',
    labelEn: 'Joy',
    promptTags: ['joyful', 'bright', 'uplifting', 'playful warmth'],
    aliases: ['充满快乐', '喜悦', '开心', '快乐', '愉悦', '兴奋', '甜蜜', '陶醉', '欢快', '庆祝', '明亮', '幸福', '雀跃', 'joyful', 'happiness', 'happy', 'cheerful', 'delight', 'uplifting'],
  },
  {
    id: 'sadness',
    labelZh: '悲伤',
    labelEn: 'Sadness',
    promptTags: ['melancholic', 'lonely', 'vulnerable', 'rain-soaked introspection'],
    aliases: ['并没有感到开心', '没有感到开心', '雨天的孤独感', '并不开心', '没有希望', '不开心', '不快乐', '孤独感', '悲伤', '难过', '失落', '孤独', '孤单', '低落', '忧郁', '伤感', '心碎', '绝望', '哭泣', '雨天', 'not very happy', 'not really happy', 'no longer happy', 'without happiness', 'not happy', 'hopeless', 'unhappy', 'melancholic', 'loneliness', 'lonely', 'sadness', 'sorrow', 'heartbroken', 'sad'],
  },
  {
    id: 'tension',
    labelZh: '紧张',
    labelEn: 'Tension',
    promptTags: ['tense', 'suspenseful', 'restless pulse', 'controlled unease'],
    aliases: ['压迫感', '蓄势待发', '紧张', '焦虑', '不安', '压迫', '悬疑', '危机', '蓄势', '迫近', '惊险', '忐忑', 'tense', 'tension', 'anxious', 'anxiety', 'suspense', 'restless', 'stress'],
  },
  {
    id: 'healing',
    labelZh: '治愈',
    labelEn: 'Healing',
    promptTags: ['healing', 'gentle reassurance', 'tender release', 'soft comforting warmth'],
    aliases: ['被治愈', '治愈', '疗愈', '温柔', '释然', '释放', '安慰', '抚慰', '包容', '暖意', '温暖', '松弛', 'healing', 'soothing', 'comforting', 'reassuring', 'relief', 'tender'],
  },
  {
    id: 'calm',
    labelZh: '平静',
    labelEn: 'Calm',
    promptTags: ['calm', 'serene', 'spacious', 'meditative stillness'],
    aliases: ['非常安静', '内心平静', '平静', '安静', '宁静', '安宁', '放空', '沉浸', '克制', '平和', '舒缓', '沉稳', '静谧', 'calm', 'quiet', 'peaceful', 'serene', 'meditative', 'tranquil'],
  },
  {
    id: 'hope',
    labelZh: '希望',
    labelEn: 'Hope',
    promptTags: ['hopeful', 'rising light', 'quiet resilience', 'forward-looking optimism'],
    aliases: ['充满希望', '新的开始', '希望', '期待', '曙光', '未来', '重生', '向前', '坚定', '勇气', '光明', '盼望', 'hopeful', 'optimistic', 'anticipation', 'resilient', 'new beginning', 'hope'],
  },
  {
    id: 'nostalgia',
    labelZh: '怀念',
    labelEn: 'Nostalgia',
    promptTags: ['nostalgic', 'bittersweet memory', 'faded warmth', 'intimate reflection'],
    aliases: ['旧时光', '回忆往事', '怀念', '回忆', '青春', '告别', '往事', '乡愁', '复古', '留恋', 'nostalgic', 'nostalgia', 'memories', 'reminiscence', 'bittersweet memory'],
  },
  {
    id: 'triumph',
    labelZh: '胜利',
    labelEn: 'Triumph',
    promptTags: ['triumphant', 'heroic', 'expansive', 'confident resolution'],
    aliases: ['取得胜利', '史诗感', '胜利', '凯旋', '英雄', '自信', '震撼', '史诗', '荣耀', '决战', '壮阔', '成就', 'triumphant', 'victory', 'heroic', 'epic', 'confident', 'glorious'],
  },
  {
    id: 'mystery',
    labelZh: '神秘',
    labelEn: 'Mystery',
    promptTags: ['mysterious', 'enigmatic', 'ethereal', 'shadowy wonder'],
    aliases: ['神秘感', '未知世界', '神秘', '未知', '迷雾', '夜色', '深夜', '梦境', '奇幻', '空灵', '玄妙', '诡秘', 'mysterious', 'mystery', 'enigmatic', 'ethereal', 'dreamlike', 'unknown'],
  },
  {
    id: 'anger',
    labelZh: '愤怒',
    labelEn: 'Anger',
    promptTags: ['angry', 'aggressive', 'volatile', 'explosive force'],
    aliases: ['怒火中烧', '愤怒', '怒火', '狂暴', '爆发', '冲突', '攻击', '激烈', '暴躁', '失控', 'anger', 'angry', 'rage', 'furious', 'aggressive', 'explosive'],
  },
] as const

const taxonomyById = new Map(emotionTaxonomy.map((emotion) => [emotion.id, emotion]))
const contrastPattern = /(但是|但|却|不过|然而|可是|只是|but|yet|however|although)/giu
const englishWordCharacterPattern = /[a-z0-9_]/iu
const englishNegationPattern = /\b(?:not|never|without|no\s+longer|(?:isn|wasn|weren|aren|don|doesn|didn|can|couldn|wouldn|shouldn|won)['’]?t)\b(?:(?:\s|[,:'"“”‘’\-])*(?:at\s+all|very|really|particularly|especially|quite|so|too|exactly|currently|actually|truly|even|feeling|feel|felt|being|any))*[\s,:'"“”‘’\-]*$/iu
const chineseNegationPattern = /(?:并没有|并非|并没|并不|不是|没有|不会|不再|不太|没能|不|没|无|非)(?:(?:\s|[，、,：:'"“”‘’\-])*(?:真的?|太|很|特别|十分|非常|怎么|那么|觉得|感到|感觉|显得|算是|自己|再|任何|一点|丝毫|完全|真正地?))*[\s，、,：:'"“”‘’\-]*$/u

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1_000)
}

function definition(id: EmotionId) {
  return taxonomyById.get(id) ?? emotionTaxonomy[4]
}

function createMatch(id: EmotionId, confidence: number, matchedTerms: string[]): EmotionMatch {
  const emotion = definition(id)
  return {
    id,
    labelZh: emotion.labelZh,
    labelEn: emotion.labelEn,
    promptTags: [...emotion.promptTags],
    confidence: Math.round(Math.max(0, Math.min(0.99, confidence)) * 100) / 100,
    matchedTerms: [...new Set(matchedTerms)].slice(0, 8),
  }
}

function segmentText(text: string) {
  const segments: Array<{ text: string; multiplier: number }> = []
  let cursor = 0
  let match: RegExpExecArray | null
  contrastPattern.lastIndex = 0
  while ((match = contrastPattern.exec(text))) {
    const before = text.slice(cursor, match.index).trim()
    if (before) segments.push({ text: before, multiplier: segments.length ? 1.12 : 1 })
    cursor = match.index + match[0].length
  }
  const tail = text.slice(cursor).trim()
  if (tail) segments.push({ text: tail, multiplier: segments.length ? 1.42 : 1 })
  return segments.length ? segments : [{ text, multiplier: 1 }]
}

function hasEnglishWordBoundaries(text: string, alias: string, start: number, end: number) {
  if (!/[a-z]/iu.test(alias)) return true
  const before = text[start - 1]
  const after = text[end]
  return (!before || !englishWordCharacterPattern.test(before))
    && (!after || !englishWordCharacterPattern.test(after))
}

function isNegated(text: string, index: number) {
  const prefix = text.slice(Math.max(0, index - 48), index)
  return englishNegationPattern.test(prefix) || chineseNegationPattern.test(prefix)
}

function scoreText(raw: string) {
  const text = normalizeText(raw)
  const scores = new Map<EmotionId, number>()
  const matches = new Map<EmotionId, string[]>()

  for (const segment of segmentText(text)) {
    for (const emotion of emotionTaxonomy) {
      const occupied: Array<[number, number]> = []
      for (const aliasValue of [...emotion.aliases].sort((left, right) => right.length - left.length)) {
        const alias = normalizeText(aliasValue)
        if (!alias) continue
        let from = 0
        while (from < segment.text.length) {
          const index = segment.text.indexOf(alias, from)
          if (index < 0) break
          from = index + Math.max(1, alias.length)
          const end = index + alias.length
          if (occupied.some(([start, stop]) => index < stop && end > start)) continue
          if (!hasEnglishWordBoundaries(segment.text, alias, index, end)) continue
          if (isNegated(segment.text, index)) continue
          occupied.push([index, end])
          const specificity = 1 + Math.min(1.8, Array.from(alias).length / 5)
          scores.set(emotion.id, (scores.get(emotion.id) || 0) + specificity * segment.multiplier)
          matches.set(emotion.id, [...(matches.get(emotion.id) || []), aliasValue])
        }
      }
    }
  }

  return { text, scores, matches }
}

export function isEmotionId(value: unknown): value is EmotionId {
  return typeof value === 'string' && emotionIds.includes(value as EmotionId)
}

export function classifyEmotionText(raw: string): EmotionNodeAnalysis {
  const scored = scoreText(raw)
  const ranked = [...scored.scores.entries()].sort((left, right) => right[1] - left[1])
  if (!ranked.length) {
    return {
      raw: normalizeText(raw),
      primary: createMatch('calm', 0.28, []),
      fallback: true,
    }
  }

  const total = ranked.reduce((sum, [, score]) => sum + score, 0)
  const [primaryId, primaryScore] = ranked[0]
  const secondaryEntry = ranked[1]
  const margin = primaryScore - (secondaryEntry?.[1] || 0)
  const confidence = 0.56 + (primaryScore / Math.max(1, total)) * 0.28 + (margin / Math.max(1, total)) * 0.12
  const primary = createMatch(primaryId, confidence, scored.matches.get(primaryId) || [])
  const secondary = secondaryEntry && secondaryEntry[1] >= primaryScore * 0.28
    ? createMatch(secondaryEntry[0], Math.min(0.88, 0.38 + secondaryEntry[1] / Math.max(1, total) * 0.45), scored.matches.get(secondaryEntry[0]) || [])
    : undefined

  return {
    raw: normalizeText(raw),
    primary,
    secondary,
    fallback: false,
  }
}

function addAggregateScore(scores: Map<EmotionId, number>, analysis: EmotionNodeAnalysis, weight: number) {
  if (analysis.fallback || weight <= 0) return
  scores.set(analysis.primary.id, (scores.get(analysis.primary.id) || 0) + weight * analysis.primary.confidence)
  if (analysis.secondary) {
    scores.set(analysis.secondary.id, (scores.get(analysis.secondary.id) || 0) + weight * analysis.secondary.confidence * 0.45)
  }
}

export function analyzeEmotionContext(input: EmotionContextInput): EmotionAnalysis {
  const duration = Math.max(10, Math.min(600, Number(input.duration) || 60))
  const moods = [...(input.moods || [])]
    .slice(0, 12)
    .map((point) => ({
      label: normalizeText(point.label).slice(0, 160),
      time: Math.max(0, Math.min(duration, Number(point.time) || 0)),
      intensity: Math.max(0, Math.min(100, Number(point.intensity) || 0)),
    }))
    .sort((left, right) => left.time - right.time)
  const nodes = moods.map((point) => classifyEmotionText(point.label))
  const aggregate = new Map<EmotionId, number>()

  nodes.forEach((analysis, index) => {
    const point = moods[index]
    const nextTime = moods[index + 1]?.time ?? duration
    const span = Math.max(duration * 0.08, nextTime - point.time)
    const weight = span * Math.max(0.18, point.intensity / 100)
    addAggregateScore(aggregate, analysis, weight)
  })

  const description = classifyEmotionText(input.description)
  if (normalizeText(input.description)) addAggregateScore(aggregate, description, duration * 1.25)

  const context = classifyEmotionText(`${input.title} ${input.scene} ${input.style}`)
  if (!context.fallback) addAggregateScore(aggregate, context, duration * 0.24)

  const ranked = [...aggregate.entries()].sort((left, right) => right[1] - left[1])
  const primaryId = ranked[0]?.[0] ?? 'calm'
  const primaryScore = ranked[0]?.[1] ?? 0
  const secondaryId = ranked.find(([id, score]) => id !== primaryId && score >= primaryScore * 0.22)?.[0]
  const total = ranked.reduce((sum, [, score]) => sum + score, 0)
  const margin = primaryScore - (ranked.find(([id]) => id !== primaryId)?.[1] || 0)
  const fallback = !ranked.length
  const primaryTerms = [
    ...nodes.filter((node) => node.primary.id === primaryId).flatMap((node) => node.primary.matchedTerms),
    ...(description.primary.id === primaryId ? description.primary.matchedTerms : []),
    ...(context.primary.id === primaryId ? context.primary.matchedTerms : []),
  ]
  const primaryConfidence = fallback
    ? 0.28
    : Math.min(0.97, 0.58 + primaryScore / Math.max(1, total) * 0.25 + margin / Math.max(1, total) * 0.12)
  const primary = createMatch(primaryId, primaryConfidence, primaryTerms)
  const secondary = secondaryId
    ? createMatch(secondaryId, Math.min(0.86, 0.42 + (aggregate.get(secondaryId) || 0) / Math.max(1, total) * 0.42), [
        ...nodes.filter((node) => node.primary.id === secondaryId || node.secondary?.id === secondaryId)
          .flatMap((node) => node.primary.id === secondaryId ? node.primary.matchedTerms : node.secondary?.matchedTerms || []),
        ...(description.primary.id === secondaryId ? description.primary.matchedTerms : description.secondary?.id === secondaryId ? description.secondary.matchedTerms : []),
      ])
    : undefined
  const summary = secondary
    ? `${primary.labelZh}为主，融合${secondary.labelZh}`
    : primary.labelZh

  return {
    agent: 'moodtrack-text-agent-v1',
    primary,
    secondary,
    nodes,
    referenceEmotionId: !fallback && primary.confidence >= 0.55 ? primary.id : null,
    fallback,
    summary,
  }
}

export function emotionLabel(id: EmotionId) {
  const emotion = definition(id)
  return { labelZh: emotion.labelZh, labelEn: emotion.labelEn, promptTags: [...emotion.promptTags] }
}
