<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { checkAceStepHealth, generateAceStepSoundtrack, repaintAceStepSoundtrack, type EmotionAnalysisResult } from './aceStepClient'
import { checkGvmgenHealth, generateGvmgenSoundtrack, type GvmgenResult } from './gvmgenClient'
import { analyzeVideoFile, type VideoMusicAnalysis } from './video2music'

type MoodPoint = {
  label: string
  time: number
  intensity: number
}

type AppPage = 'landing' | 'studio'
type StudioPane = 'create' | 'result' | 'versions'

type Preset = {
  id: string
  emoji: string
  label: string
  eyebrow: string
  title: string
  scene: string
  style: string
  emotionDescription: string
  duration: number
  bpm: number
  musicKey: string
  instruments: string[]
  description: string
  acePrompt: string
  instrumentalStructure: string
  vocalStyle: string
  defaultLyrics: string
  moods: MoodPoint[]
}

type TrackVersion = {
  id: string
  label: string
  taskId: string
  audioUrl: string
  downloadName: string
  sourceFile: string
  duration: number
  variationName: string
  instruction: string
  rangeStart: number
  rangeEnd: number
  lyrics: string
  instrumental: boolean
  vocalLanguage: string
  emotionAnalysis: EmotionAnalysisResult | null
  audioDigest: string
}

const presets: Preset[] = [
  {
    id: 'midnight',
    emoji: '◐',
    label: '深夜驰骋',
    eyebrow: 'MIDNIGHT DRIVE',
    title: '凌晨两点的城市',
    scene: '城市夜景 Vlog',
    style: '电影感 Synthwave · 夜行 Downtempo · 温暖模拟质感',
    emotionDescription: '深夜独处的沉浸感，略带孤独，但最终回到安宁与放松。',
    duration: 60,
    bpm: 92,
    musicKey: 'F minor',
    instruments: ['Juno Pad', 'Rhodes', 'LinnDrum', 'Mono Synth Bass'],
    description: 'Juno 合成器与 Rhodes 铺出夜色，LinnDrum 保持稳定巡航；十六分音符琶音逐步打开，在高潮形成宽阔但克制的霓虹声场。',
    acePrompt: 'Instrumental cinematic synthwave and nocturnal downtempo, dreamy and restrained. Juno-style analog pads, muted Rhodes piano, pulsing mono synth bass, soft LinnDrum kick, gated snare, subtle sixteenth-note arpeggiator and distant neon ambience. Warm tape saturation, wide stereo and a steady night-driving groove. No guitars, orchestral brass, trap hats or vocals.',
    instrumentalStructure: '[Intro - distant analog pads and filtered city ambience]\n[Instrumental - Rhodes motif over restrained drum machine]\n[Bridge - arpeggiator and synth bass grow wider]\n[Instrumental - expansive but restrained neon peak]\n[Outro - drums drop out and warm pads resolve]',
    vocalStyle: '清澈、略带气声的年轻女声，主歌克制贴耳，副歌打开音域并加入轻柔和声',
    defaultLyrics: '[Intro]\n\n[Verse 1]\n凌晨两点 城市还醒着\n车窗倒映 没说完的梦\n路灯一盏一盏向后退\n我把心事交给晚风\n\n[Pre-Chorus]\n穿过安静的路口\n今夜不问终点\n\n[Chorus]\n让我沿着霓虹向前\n把昨天留在身后一点\n当心跳和街灯重叠\n我会找到自己的明天\n\n[Outro]\n天亮以前 继续向前',
    moods: [
      { label: '放空', time: 0, intensity: 28 },
      { label: '沉浸', time: 18, intensity: 48 },
      { label: '陶醉', time: 42, intensity: 82 },
      { label: '安宁', time: 60, intensity: 38 },
    ],
  },
  {
    id: 'graduation',
    emoji: '✦',
    label: '毕业回忆',
    eyebrow: 'GRADUATION FILM',
    title: '再见以前，奔赴以后',
    scene: '毕业纪念短片',
    style: '现代室内流行 · 温暖怀旧 · 克制成长感',
    emotionDescription: '怀念与告别交织，失落但充满希望，最后温柔释然。',
    duration: 75,
    bpm: 84,
    musicKey: 'D major',
    instruments: ['Felt Piano', 'Fingerpicked Guitar', 'Chamber Strings', 'Brush Kit'],
    description: '毛毡钢琴先陈述记忆主题，指弹木吉他提供温柔脉动；大提琴与中提琴从独奏扩展为室内乐群，高潮明亮而不煽情。',
    acePrompt: 'Instrumental modern chamber pop for a graduation film, nostalgic but hopeful and intimate. Felt piano carries a memorable motif, fingerpicked acoustic guitar adds motion, cello and viola ensemble swells gradually, supported by soft electric bass, brushed snare and light glockenspiel. Natural room sound with a gentle cinematic lift. No EDM synths, trailer brass, heavy drums or vocals.',
    instrumentalStructure: '[Intro - intimate felt piano alone]\n[Instrumental - fingerpicked guitar joins the memory theme]\n[Bridge - cello and viola begin a patient crescendo]\n[Instrumental - hopeful full chamber-pop climax]\n[Outro - piano motif returns with a soft final cadence]',
    vocalStyle: '温暖自然的青年女声，像近距离讲述回忆，副歌加入轻柔群唱与室内乐和声',
    defaultLyrics: '[Intro]\n\n[Verse 1]\n最后一次走过长长走廊\n窗边的位置还留着阳光\n黑板上的字慢慢被擦掉\n笑声却还在耳边回响\n\n[Pre-Chorus]\n我们把名字写进夏天\n也把告别藏进照片\n\n[Chorus]\n再见以前 奔赴以后\n带着彼此给过的温柔\n就算未来在不同路口\n想起今天 依然会抬起头\n\n[Outro]\n青春不散场 我们后会有期',
    moods: [
      { label: '平静', time: 0, intensity: 24 },
      { label: '怀念', time: 22, intensity: 52 },
      { label: '释放', time: 55, intensity: 88 },
      { label: '释然', time: 75, intensity: 42 },
    ],
  },
  {
    id: 'battle',
    emoji: '⚔',
    label: '史诗战斗',
    eyebrow: 'EPIC BATTLE',
    title: '最后一道防线',
    scene: '动作 RPG 终局战',
    style: '混合管弦战斗配乐 · 低弦固定音型 · 重型战鼓',
    emotionDescription: '从压迫与紧张逐步爆发，穿过危机后抵达坚定、英雄式的胜利。',
    duration: 90,
    bpm: 138,
    musicKey: 'C minor',
    instruments: ['Spiccato Low Strings', 'French Horns', 'Taiko Ensemble', 'Hybrid Pulse'],
    description: '大提琴与低音提琴以快速跳弓固定音型驱动战斗，圆号与长号以短促乐句回应；太鼓、Gran Cassa 与低频冲击在决战段完全展开。',
    acePrompt: 'Instrumental hybrid orchestral action score for a final boss battle, relentless and heroic. Fast spiccato cellos and basses drive a dark ostinato; French horns, trumpets and trombones answer in bold phrases; taiko ensemble, gran cassa, toms, cymbal swells, low synth pulse and sub impacts build to a decisive climax. Modern cinematic mix, sharp attacks and huge dynamics. No lo-fi drums, pop piano or vocals.',
    instrumentalStructure: '[Intro - low string ostinato and distant war drums]\n[Instrumental - brass calls answer rising taiko patterns]\n[Bridge - tension drops to low pulse and tremolo strings]\n[Instrumental - full brass, spiccato strings and massive battle climax]\n[Outro - victorious horn cadence over final low impact]',
    vocalStyle: '有力量的青年男声，短句咬字坚定，副歌加入史诗合唱但保持主唱清晰',
    defaultLyrics: '[Intro]\n\n[Verse 1]\n黑云压住最后的城墙\n风里传来战鼓的回响\n身后是我守护的名字\n面前再黑也不能退让\n\n[Pre-Chorus]\n握紧手中的光\n让沉默变成锋芒\n\n[Chorus]\n越过风暴 越过绝望\n最后一道防线由我来扛\n就算今夜燃尽所有力量\n也要让黎明照进这片战场\n\n[Bridge]\n听见同伴在呼喊\n我们并肩直到终章\n\n[Final Chorus]\n越过风暴 迎接曙光\n胜利会记住我们的模样',
    moods: [
      { label: '蓄势', time: 0, intensity: 34 },
      { label: '紧张', time: 28, intensity: 68 },
      { label: '爆发', time: 66, intensity: 100 },
      { label: '胜利', time: 90, intensity: 62 },
    ],
  },
  {
    id: 'launch',
    emoji: '⌁',
    label: '品牌发布',
    eyebrow: 'PRODUCT LAUNCH',
    title: '下一秒，抵达未来',
    scene: '新品发布会开场',
    style: '极简未来电子 · 精准脉冲 · 高级科技质感',
    emotionDescription: '由神秘和期待开始，逐层建立自信，最终形成明亮而震撼的揭晓。',
    duration: 45,
    bpm: 118,
    musicKey: 'A minor',
    instruments: ['Glass Pluck', 'Pulse Bass', 'Electro Drums', 'Air Pad'],
    description: '玻璃质感 Pluck 建立品牌动机，精准脉冲低音与电子鼓逐层加入；空气 Pad、滤波上升音和一次简洁 Logo Hit 完成产品揭晓。',
    acePrompt: 'Instrumental minimal futuristic electronic cue for a premium product reveal, precise, confident and progressive. Glassy pluck synth motif, clean pulse bass, tight electronic kick and clap, digital percussion, airy pads, filtered risers and one concise sonic-logo hit. Polished high-tech mix with controlled low end and generous space. No acoustic guitar, orchestral strings, festival EDM drop or vocals.',
    instrumentalStructure: '[Intro - isolated glass pluck and spacious digital air]\n[Instrumental - pulse bass and precise electronic groove enter]\n[Bridge - filtered riser and widening pads build anticipation]\n[Instrumental - confident reveal with a concise sonic-logo hit]\n[Outro - clean pluck motif and short resolved tail]',
    vocalStyle: '冷静自信的中性电子流行人声，主歌简洁有节奏，副歌以多层和声形成品牌记忆点',
    defaultLyrics: '[Intro]\n\n[Verse 1]\n一道光划开边界\n新的坐标正在出现\n把想象放进指尖\n下一秒改变世界\n\n[Pre-Chorus]\n现在 让未来被看见\n\n[Chorus]\n向前 向前\n我们抵达新的起点\n向前 向前\n让每一次可能都实现\n\n[Outro]\n下一秒 抵达未来',
    moods: [
      { label: '神秘', time: 0, intensity: 26 },
      { label: '期待', time: 14, intensity: 54 },
      { label: '震撼', time: 34, intensity: 94 },
      { label: '自信', time: 45, intensity: 68 },
    ],
  },
  {
    id: 'freeform',
    emoji: '✎',
    label: '自由场景',
    eyebrow: 'FREE PROMPT',
    title: '',
    scene: '',
    style: '',
    emotionDescription: '',
    duration: 60,
    bpm: 0,
    musicKey: '',
    instruments: [],
    description: '不套用任何场景预设；编曲、乐器、速度与调式均优先遵循你的创作 Prompt。',
    acePrompt: '',
    instrumentalStructure: '[Instrumental]',
    vocalStyle: '',
    defaultLyrics: '',
    moods: [
      { label: '开始', time: 0, intensity: 45 },
      { label: '发展', time: 30, intensity: 65 },
      { label: '结束', time: 60, intensity: 50 },
    ],
  },
]

const activePreset = ref(presets[0].id)
const title = ref(presets[0].title)
const scene = ref(presets[0].scene)
const style = ref(presets[0].style)
const emotionDescription = ref(presets[0].emotionDescription)
const duration = ref(presets[0].duration)
let previousDuration = presets[0].duration
const instrumental = ref(false)
const vocalStyle = ref(presets[0].vocalStyle)
const vocalLanguage = ref('zh')
const lyrics = ref(presets[0].defaultLyrics)
const moods = ref<MoodPoint[]>(presets[0].moods.map((point) => ({ ...point })))
const generated = ref(false)
const generating = ref(false)
const repainting = ref(false)
const notice = ref('工作区已自动保存')
const generationNumber = ref(0)
const trackCode = ref('')
const compositionVariant = ref('')
const audioSource = ref('/audio/midnight-drive.wav')
const downloadName = ref('MoodTrack-demo.wav')
const generatedAudioUrls = new Set<string>()
const acceptedAudioDigests = new Set<string>()
const trackVersions = ref<TrackVersion[]>([])
const sourceVersionIndex = ref(0)
const compareLeftIndex = ref(0)
const compareRightIndex = ref(0)
const editStart = ref(12)
const editEnd = ref(30)
const editStrength = ref(65)
const editInstruction = ref('保留主旋律和人声，只增强所选段落的鼓组力度、动态推进和空间层次')
const videoInput = ref<HTMLInputElement | null>(null)
const videoFile = ref<File | null>(null)
const videoPreviewUrl = ref('')
const videoAnalysis = ref<VideoMusicAnalysis | null>(null)
const analyzingVideo = ref(false)
const videoProgress = ref(0)
const videoStatus = ref('等待视频')
const videoError = ref('')
const videoModeActive = ref(false)
const video2MusicOpen = ref(false)
const gvmgenOnline = ref(false)
const gvmgenGenerating = ref(false)
const gvmgenResult = ref<GvmgenResult | null>(null)
const acceptedVideoAudioDigests = new Set<string>()
const acceptedVideoJobIds = new Set<string>()
const aceStepOnline = ref(false)
const currentEmotionAnalysis = ref<EmotionAnalysisResult | null>(null)
const currentPage = ref<AppPage>(pageFromPath(window.location.pathname))
const studioPane = ref<StudioPane>('create')
let healthTimer: number | null = null
let videoRunId = 0
let musicRunId = 0
let repaintRunId = 0
const sessionCompositionSeed = Math.floor(Math.random() * 10_000)
const resultSection = ref<HTMLElement | null>(null)
const videoOutputSection = ref<HTMLElement | null>(null)
const timeline = ref<HTMLElement | null>(null)
const dragging = ref<number | null>(null)

const activePlan = computed(() => presets.find((preset) => preset.id === activePreset.value) ?? presets[0])
const isFreeScene = computed(() => activePreset.value === 'freeform')
const selectedSourceVersion = computed(() => trackVersions.value[sourceVersionIndex.value] ?? trackVersions.value[trackVersions.value.length - 1])
const compareLeftVersion = computed(() => trackVersions.value[compareLeftIndex.value])
const compareRightVersion = computed(() => trackVersions.value[compareRightIndex.value])
const currentBpm = computed(() => videoModeActive.value && videoAnalysis.value ? videoAnalysis.value.bpm : activePlan.value.bpm || 'AUTO')
const currentMusicKey = computed(() => videoModeActive.value && videoAnalysis.value ? videoAnalysis.value.musicKey : activePlan.value.musicKey || 'AUTO')
const currentInstruments = computed(() => videoModeActive.value && videoAnalysis.value ? videoAnalysis.value.instruments : activePlan.value.instruments)
const currentDescription = computed(() => videoModeActive.value && videoAnalysis.value ? videoAnalysis.value.description : activePlan.value.description)
const currentPlanLabel = computed(() => videoModeActive.value ? 'VIDEO2MUSIC' : activePlan.value.label)
const renderedVideoDownloadName = computed(() => {
  const base = (videoAnalysis.value?.sourceName || 'MoodTrack').replace(/\.[^.]+$/, '') || 'MoodTrack'
  const version = gvmgenResult.value?.jobId.slice(0, 6).toUpperCase() || 'rendered'
  return `${base}-${version}-rendered.mp4`
})
const isStudioPage = computed(() => currentPage.value === 'studio')
const steps = computed(() => [
  { index: '01', label: '项目设定', state: 'done' },
  { index: '02', label: '情绪轨道', state: generated.value ? 'done' : 'active' },
  { index: '03', label: 'AI 编曲', state: generated.value ? 'done' : 'next' },
  { index: '04', label: '试听导出', state: generated.value ? 'active' : 'next' },
])

function createWaveform(seed = 0) {
  return Array.from({ length: 74 }, (_, index) => {
    const phase = (seed % 31) * 0.07
    const pulse = Math.sin(index * (0.61 + (seed % 5) * 0.025) + phase) * 20
      + Math.cos(index * (0.19 + (seed % 7) * 0.013) - phase) * 12
    return Math.max(14, Math.min(92, 45 + pulse + ((index + seed) % 7) * 2))
  })
}

const waveform = ref(createWaveform())

function applyPreset(preset: Preset) {
  generatedAudioUrls.forEach((url) => URL.revokeObjectURL(url))
  generatedAudioUrls.clear()
  trackVersions.value = []
  sourceVersionIndex.value = 0
  compareLeftIndex.value = 0
  compareRightIndex.value = 0
  activePreset.value = preset.id
  title.value = preset.title
  scene.value = preset.scene
  style.value = preset.style
  emotionDescription.value = preset.emotionDescription
  duration.value = preset.duration
  previousDuration = preset.duration
  vocalStyle.value = preset.vocalStyle
  lyrics.value = preset.defaultLyrics
  moods.value = preset.moods.map((point) => ({ ...point }))
  currentEmotionAnalysis.value = null
  videoModeActive.value = false
  generated.value = false
  audioSource.value = '/audio/midnight-drive.wav'
  downloadName.value = 'MoodTrack-demo.wav'
  notice.value = `已载入「${preset.label}」场景`
  studioPane.value = 'create'
}

function invalidateEmotionAnalysis() {
  if (generating.value || repainting.value) return
  generated.value = false
  currentEmotionAnalysis.value = null
}

function updateDurationAndEmotionTimeline() {
  const nextDuration = Math.max(15, Math.min(180, Math.round(Number(duration.value) || previousDuration)))
  const sourceDuration = Math.max(1, previousDuration)
  duration.value = nextDuration
  moods.value = moods.value.map((point) => ({
    ...point,
    time: Math.max(0, Math.min(nextDuration, Math.round((point.time / sourceDuration) * nextDuration))),
  }))
  previousDuration = nextDuration
  invalidateEmotionAnalysis()
}

function addMood() {
  const lastTime = moods.value.length ? Math.max(...moods.value.map((point) => point.time)) : 0
  moods.value.push({
    label: '新情绪',
    time: Math.min(duration.value, Math.round(lastTime + duration.value * 0.15)),
    intensity: 55,
  })
  generated.value = false
  currentEmotionAnalysis.value = null
  notice.value = '已添加情绪节点'
}

function removeMood(index: number) {
  if (moods.value.length <= 2) {
    notice.value = '至少保留两个情绪节点'
    return
  }
  moods.value.splice(index, 1)
  generated.value = false
  currentEmotionAnalysis.value = null
  notice.value = '已移除情绪节点'
}

function updateFromPointer(event: PointerEvent) {
  if (generating.value || repainting.value || dragging.value === null || !timeline.value) return
  const point = moods.value[dragging.value]
  if (!point) return
  const rect = timeline.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
  point.time = Math.round((x / rect.width) * duration.value)
  point.intensity = Math.round(100 - (y / rect.height) * 100)
  generated.value = false
  currentEmotionAnalysis.value = null
}

function stopDragging() {
  dragging.value = null
  window.removeEventListener('pointermove', updateFromPointer)
  window.removeEventListener('pointerup', stopDragging)
  notice.value = '情绪曲线已更新'
}

function startDragging(index: number, event: PointerEvent) {
  if (generating.value || repainting.value) return
  dragging.value = index
  event.preventDefault()
  window.addEventListener('pointermove', updateFromPointer)
  window.addEventListener('pointerup', stopDragging, { once: true })
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

function formatProgressStatus(message: string, progress: number) {
  const status = message.trim()
  return /\d{1,3}%/.test(status) ? status : `${status} · ${Math.round(progress)}%`
}

function chooseVideo() {
  videoInput.value?.click()
}

async function openVideo2Music() {
  if (!isStudioPage.value) await navigateToPage('studio')
  video2MusicOpen.value = true
  document.body.classList.add('modal-open')
}

function closeVideo2Music() {
  video2MusicOpen.value = false
  document.body.classList.remove('modal-open')
}

function handleModalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && video2MusicOpen.value) closeVideo2Music()
}

function setVideoFile(file: File) {
  videoRunId += 1
  audio.value?.pause()
  playing.value = false
  currentTime.value = 0
  audioSource.value = ''
  downloadName.value = 'MoodTrack-video-soundtrack.wav'
  if (videoPreviewUrl.value) URL.revokeObjectURL(videoPreviewUrl.value)
  videoPreviewUrl.value = ''
  videoFile.value = null
  videoAnalysis.value = null
  gvmgenResult.value = null
  videoModeActive.value = false
  videoProgress.value = 0
  generated.value = false
  trackVersions.value = []
  sourceVersionIndex.value = 0
  compareLeftIndex.value = 0
  compareRightIndex.value = 0
  if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
    videoError.value = '请选择 MP4、WebM、MOV 或 M4V 视频'
    videoStatus.value = '文件未载入'
    notice.value = videoError.value
    return
  }
  if (file.size > 50 * 1024 * 1024) {
    videoError.value = '免费云存储版暂时支持 50MB 以内的视频'
    videoStatus.value = '文件未载入'
    notice.value = videoError.value
    return
  }
  videoFile.value = file
  videoPreviewUrl.value = URL.createObjectURL(file)
  videoStatus.value = '视频已就绪'
  videoError.value = ''
  notice.value = `已载入视频：${file.name}`
}

function handleVideoInput(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) setVideoFile(file)
}

function handleVideoDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  if (file) setVideoFile(file)
}

function clearVideo() {
  videoRunId += 1
  audio.value?.pause()
  playing.value = false
  currentTime.value = 0
  if (videoPreviewUrl.value) URL.revokeObjectURL(videoPreviewUrl.value)
  videoPreviewUrl.value = ''
  videoFile.value = null
  videoAnalysis.value = null
  gvmgenResult.value = null
  videoProgress.value = 0
  videoStatus.value = '等待视频'
  videoError.value = ''
  if (videoModeActive.value) {
    videoModeActive.value = false
    generated.value = false
    audioSource.value = '/audio/midnight-drive.wav'
    downloadName.value = 'MoodTrack-demo.wav'
  }
  if (videoInput.value) videoInput.value.value = ''
}

async function analyzeSelectedVideo() {
  const selectedFile = videoFile.value
  const selectedRunId = videoRunId
  if (!selectedFile || analyzingVideo.value) return null
  analyzingVideo.value = true
  videoError.value = ''
  try {
    const analysis = await analyzeVideoFile(selectedFile, (progress, message) => {
      if (selectedRunId !== videoRunId || videoFile.value !== selectedFile) return
      videoProgress.value = progress
      videoStatus.value = message
      notice.value = message
    })
    if (selectedRunId !== videoRunId || videoFile.value !== selectedFile) return null
    videoAnalysis.value = analysis
    notice.value = '视频视觉节奏分析完成，可以生成配乐'
    return analysis
  } catch (error) {
    if (selectedRunId !== videoRunId || videoFile.value !== selectedFile) return null
    console.error('Failed to analyze video', error)
    videoError.value = error instanceof Error ? error.message : '视频分析失败，请更换格式后重试'
    videoStatus.value = '分析失败'
    notice.value = videoError.value
    return null
  } finally {
    analyzingVideo.value = false
  }
}

function applyVideoPlan(analysis: VideoMusicAnalysis) {
  const baseName = analysis.sourceName.replace(/\.[^.]+$/, '') || 'Video2Music'
  title.value = `${baseName} · 视频配乐`
  scene.value = `${analysis.width}×${analysis.height} 视频配乐`
  style.value = analysis.style
  emotionDescription.value = analysis.description
  duration.value = analysis.musicDuration
  previousDuration = analysis.musicDuration
  moods.value = analysis.moods.map((point) => ({ ...point }))
  instrumental.value = true
  videoModeActive.value = true
  currentEmotionAnalysis.value = null
  trackVersions.value = []
  generated.value = false
}

async function showVideoOutput(expectedRunId?: number, expectedFile?: File) {
  if (expectedRunId !== undefined && (expectedRunId !== videoRunId || videoFile.value !== expectedFile)) return
  closeVideo2Music()
  studioPane.value = 'result'
  await nextTick()
  if (expectedRunId !== undefined && (expectedRunId !== videoRunId || videoFile.value !== expectedFile)) return
  videoOutputSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function generateVideoMusic() {
  const analysis = videoAnalysis.value ?? await analyzeSelectedVideo()
  if (!analysis || !videoFile.value || gvmgenGenerating.value || generating.value || repainting.value) return
  const selectedFile = videoFile.value
  const selectedRunId = videoRunId
  applyVideoPlan(analysis)
  gvmgenGenerating.value = true
  audio.value?.pause()
  playing.value = false
  currentTime.value = 0
  audioSource.value = ''
  videoProgress.value = 0
  videoStatus.value = '正在准备视频'
  videoError.value = ''
  gvmgenResult.value = null
  try {
    const result = await generateGvmgenSoundtrack(selectedFile, analysis.musicDuration, (message, progress) => {
      if (selectedRunId !== videoRunId || videoFile.value !== selectedFile) return
      videoStatus.value = message
      videoProgress.value = progress
      notice.value = message
    }, [...acceptedVideoAudioDigests])
    if (selectedRunId !== videoRunId || videoFile.value !== selectedFile) return
    if (acceptedVideoJobIds.has(result.jobId)) throw new Error('MoodTrack 返回了重复视频任务，已阻止旧结果覆盖')
    acceptedVideoAudioDigests.add(result.audioDigest)
    acceptedVideoJobIds.add(result.jobId)
    gvmgenResult.value = result
    gvmgenOnline.value = true
    audio.value?.pause()
    audioSource.value = result.audioUrl
    const videoVersion = result.jobId.slice(0, 6).toUpperCase()
    downloadName.value = `${analysis.sourceName.replace(/\.[^.]+$/, '') || 'MoodTrack'}-${videoVersion}-soundtrack.wav`
    generationNumber.value += 1
    trackCode.value = `V2M-${result.jobId.slice(0, 6).toUpperCase()}`
    compositionVariant.value = '层级视觉注意力'
    waveform.value = createWaveform([...result.jobId].reduce((total, character) => total + character.charCodeAt(0), 0))
    currentTime.value = 0
    audioDuration.value = result.duration
    duration.value = result.duration
    generated.value = true
    videoProgress.value = 100
    await nextTick()
    if (selectedRunId !== videoRunId || videoFile.value !== selectedFile) return
    audio.value?.load()
    notice.value = '视频配乐和合成视频已完成'
    await showVideoOutput(selectedRunId, selectedFile)
  } catch (error) {
    if (selectedRunId !== videoRunId || videoFile.value !== selectedFile) return
    console.error('Failed to generate video soundtrack', error)
    gvmgenOnline.value = await checkGvmgenHealth()
    if (selectedRunId !== videoRunId || videoFile.value !== selectedFile) return
    videoError.value = error instanceof Error ? error.message : '视频配乐生成失败，请稍后重试'
    notice.value = videoError.value
  } finally {
    gvmgenGenerating.value = false
  }
}

function changeMusicMode() {
  generated.value = false
  notice.value = instrumental.value ? '已切换为纯音乐模式' : '已启用 MoodTrack 人声歌曲模式'
}

async function generateMusic() {
  if (videoModeActive.value && videoFile.value) {
    await generateVideoMusic()
    return
  }
  if (generating.value || repainting.value || gvmgenGenerating.value) return
  updateDurationAndEmotionTimeline()
  if (isFreeScene.value && !style.value.trim()) {
    notice.value = '请先填写自由场景的创作 Prompt'
    return
  }
  if (!instrumental.value && !lyrics.value.trim() && !isFreeScene.value) {
    notice.value = '人声歌曲模式需要填写歌词'
    return
  }
  generating.value = true
  const runId = ++musicRunId
  generated.value = false
  playing.value = false
  audio.value?.pause()
  audioSource.value = ''
  notice.value = '正在理解情绪曲线并组织声音…'

  try {
    const nextGeneration = generationNumber.value + 1
    const variation = sessionCompositionSeed + nextGeneration
    const result = await generateAceStepSoundtrack({
      title: title.value,
      scene: scene.value,
      style: style.value,
      instruments: [...activePlan.value.instruments],
      productionPrompt: isFreeScene.value ? style.value.trim() : activePlan.value.acePrompt,
      instrumentalStructure: activePlan.value.instrumentalStructure,
      presetId: activePreset.value,
      musicKey: activePlan.value.musicKey,
      bpm: activePlan.value.bpm,
      duration: duration.value,
      moods: moods.value.map((point) => ({ ...point })),
      emotionDescription: emotionDescription.value,
      instrumental: instrumental.value,
      vocalStyle: vocalStyle.value,
      vocalLanguage: vocalLanguage.value,
      lyrics: lyrics.value,
      variation,
      excludedAudioDigests: [...acceptedAudioDigests],
      onStatus(message) {
        if (runId === musicRunId) notice.value = message
      },
      onLyricsGenerated(nextLyrics) {
        if (runId !== musicRunId) return
        lyrics.value = nextLyrics
        notice.value = '全新歌词已写好，正在交给 MoodTrack 编曲演唱…'
      },
      onEmotionClassified(analysis) {
        if (runId === musicRunId) currentEmotionAnalysis.value = analysis
      },
    })
    if (runId !== musicRunId) return

    const generatedAudioUrl = result.audioUrl
    if (trackVersions.value.some((version) => version.taskId === result.taskId)) {
      throw new Error('MoodTrack 返回了重复任务，已阻止旧音频覆盖')
    }
    acceptedAudioDigests.add(result.audioDigest)
    audioSource.value = generatedAudioUrl
    generationNumber.value = nextGeneration
    trackCode.value = `MT-${result.taskId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
    compositionVariant.value = result.variationName
    const waveformSeed = [...result.taskId].reduce((total, character) => total + character.charCodeAt(0), 0)
    waveform.value = createWaveform(waveformSeed)
    const nextDownloadName = `${title.value.trim() || 'MoodTrack'}-${trackCode.value}.wav`
    downloadName.value = nextDownloadName
    currentTime.value = 0
    audioDuration.value = result.duration
    generated.value = true
    aceStepOnline.value = true
    currentEmotionAnalysis.value = result.emotionAnalysis
    studioPane.value = 'result'

    const newVersionIndex = trackVersions.value.length
    trackVersions.value.push({
      id: result.taskId,
      label: `版本 ${String(newVersionIndex + 1).padStart(2, '0')}`,
      taskId: result.taskId,
      audioUrl: generatedAudioUrl,
      downloadName: nextDownloadName,
      sourceFile: result.sourceFile,
      duration: result.duration,
      variationName: result.variationName,
      instruction: '完整生成',
      rangeStart: 0,
      rangeEnd: result.duration,
      lyrics: result.lyrics,
      instrumental: instrumental.value,
      vocalLanguage: vocalLanguage.value,
      emotionAnalysis: result.emotionAnalysis,
      audioDigest: result.audioDigest,
    })
    sourceVersionIndex.value = newVersionIndex
    compareLeftIndex.value = Math.max(0, newVersionIndex - 1)
    compareRightIndex.value = newVersionIndex
    editStart.value = Math.max(0, Math.round(result.duration * 0.25))
    editEnd.value = Math.max(editStart.value + 1, Math.round(result.duration * 0.55))

    await nextTick()
    if (audio.value) {
      audio.value.load()
      audio.value.volume = volume.value / 100
      try {
        await audio.value.play()
        notice.value = 'MoodTrack 新音轨已生成，正在播放'
      } catch {
        notice.value = 'MoodTrack 新音轨已生成，点击播放即可试听'
      }
    }
    resultSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    if (runId !== musicRunId) return
    console.error('Failed to generate soundtrack', error)
    aceStepOnline.value = await checkAceStepHealth()
    notice.value = error instanceof Error ? error.message : 'MoodTrack 生成失败，请稍后重试'
  } finally {
    if (runId === musicRunId) generating.value = false
  }
}

function normalizeEditRange(changed: 'start' | 'end') {
  const maximum = selectedSourceVersion.value?.duration ?? duration.value
  if (changed === 'start' && editStart.value >= editEnd.value) {
    editEnd.value = Math.min(maximum, editStart.value + 1)
  }
  if (changed === 'end' && editEnd.value <= editStart.value) {
    editStart.value = Math.max(0, editEnd.value - 1)
  }
}

function fitEditRangeToSource() {
  const maximum = selectedSourceVersion.value?.duration ?? duration.value
  editStart.value = Math.max(0, Math.min(editStart.value, maximum - 0.5))
  editEnd.value = Math.max(editStart.value + 0.5, Math.min(editEnd.value, maximum))
}

async function setMainPlayerFromVersion(index: number) {
  if (repainting.value) return
  const version = trackVersions.value[index]
  if (!version) return
  document.querySelectorAll<HTMLAudioElement>('.version-audio').forEach((item) => item.pause())
  audio.value?.pause()
  sourceVersionIndex.value = index
  audioSource.value = version.audioUrl
  downloadName.value = version.downloadName
  trackCode.value = `MT-${version.taskId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
  compositionVariant.value = version.variationName
  currentTime.value = 0
  audioDuration.value = version.duration
  currentEmotionAnalysis.value = version.emotionAnalysis
  lyrics.value = version.lyrics
  instrumental.value = version.instrumental
  vocalLanguage.value = version.vocalLanguage
  generated.value = true
  studioPane.value = 'result'
  await nextTick()
  audio.value?.load()
  notice.value = `主播放器已切换到${version.label}`
}

function pauseOtherVersionAudio(event: Event) {
  const current = event.currentTarget as HTMLAudioElement
  audio.value?.pause()
  document.querySelectorAll<HTMLAudioElement>('.version-audio').forEach((item) => {
    if (item !== current) item.pause()
  })
}

async function repaintMusic() {
  if (generating.value || repainting.value || gvmgenGenerating.value) return
  const source = selectedSourceVersion.value
  const sourceIndex = sourceVersionIndex.value
  if (!source) {
    notice.value = '请先完整生成一首音乐，再进行局部修改'
    return
  }
  if (!editInstruction.value.trim()) {
    notice.value = '请描述希望如何修改所选段落'
    return
  }

  const start = Math.max(0, Math.min(source.duration - 0.5, editStart.value))
  const end = Math.max(start + 0.5, Math.min(source.duration, editEnd.value))
  editStart.value = start
  editEnd.value = end
  repainting.value = true
  const runId = ++repaintRunId
  playing.value = false
  audio.value?.pause()
  document.querySelectorAll<HTMLAudioElement>('.version-audio').forEach((item) => item.pause())

  try {
    const result = await repaintAceStepSoundtrack({
      sourceTaskId: source.taskId,
      sourceFile: source.sourceFile,
      prompt: editInstruction.value.trim(),
      lyrics: source.lyrics,
      instrumental: source.instrumental,
      vocalLanguage: source.vocalLanguage,
      bpm: activePlan.value.bpm,
      musicKey: activePlan.value.musicKey,
      duration: source.duration,
      start,
      end,
      strength: editStrength.value / 100,
      excludedAudioDigests: [...acceptedAudioDigests],
      onStatus(message) {
        if (runId === repaintRunId) notice.value = message
      },
    })
    if (runId !== repaintRunId) return

    const generatedAudioUrl = result.audioUrl
    if (trackVersions.value.some((version) => version.taskId === result.taskId)) {
      throw new Error('MoodTrack 返回了重复局部重绘任务，已阻止旧版本覆盖')
    }
    acceptedAudioDigests.add(result.audioDigest)
    const nextGeneration = generationNumber.value + 1
    const nextTrackCode = `MT-${result.taskId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
    const nextDownloadName = `${title.value.trim() || 'MoodTrack'}-${nextTrackCode}.wav`
    const newVersionIndex = trackVersions.value.length
    const nextEmotionAnalysis = source.emotionAnalysis
      ? { ...source.emotionAnalysis, reference: null }
      : result.emotionAnalysis ? { ...result.emotionAnalysis, reference: null } : null
    trackVersions.value.push({
      id: result.taskId,
      label: `版本 ${String(newVersionIndex + 1).padStart(2, '0')}`,
      taskId: result.taskId,
      audioUrl: generatedAudioUrl,
      downloadName: nextDownloadName,
      sourceFile: result.sourceFile,
      duration: result.duration,
      variationName: result.variationName,
      instruction: editInstruction.value.trim(),
      rangeStart: start,
      rangeEnd: end,
      lyrics: result.lyrics,
      instrumental: source.instrumental,
      vocalLanguage: source.vocalLanguage,
      emotionAnalysis: nextEmotionAnalysis,
      audioDigest: result.audioDigest,
    })

    currentEmotionAnalysis.value = nextEmotionAnalysis

    compareLeftIndex.value = sourceIndex
    compareRightIndex.value = newVersionIndex
    sourceVersionIndex.value = newVersionIndex
    audioSource.value = generatedAudioUrl
    downloadName.value = nextDownloadName
    generationNumber.value = nextGeneration
    trackCode.value = nextTrackCode
    compositionVariant.value = result.variationName
    const waveformSeed = [...result.taskId].reduce((total, character) => total + character.charCodeAt(0), 0)
    waveform.value = createWaveform(waveformSeed)
    currentTime.value = 0
    audioDuration.value = result.duration
    generated.value = true
    aceStepOnline.value = true
    studioPane.value = 'versions'

    await nextTick()
    if (audio.value) {
      audio.value.load()
      audio.value.volume = volume.value / 100
      try {
        await audio.value.play()
        notice.value = `局部修改完成，正在播放${trackVersions.value[newVersionIndex].label}`
      } catch {
        notice.value = `局部修改完成，可在下方对比版本 ${compareLeftIndex.value + 1} 与 ${newVersionIndex + 1}`
      }
    }
  } catch (error) {
    if (runId !== repaintRunId) return
    console.error('Failed to repaint soundtrack', error)
    aceStepOnline.value = await checkAceStepHealth()
    notice.value = error instanceof Error ? error.message : 'MoodTrack 局部修改失败，请稍后重试'
  } finally {
    if (runId === repaintRunId) repainting.value = false
  }
}

const audio = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const currentTime = ref(0)
const audioDuration = ref(60)
const volume = ref(72)

async function togglePlayback() {
  if (!audio.value) return
  if (audio.value.paused) {
    await audio.value.play()
  } else {
    audio.value.pause()
  }
}

function syncAudio() {
  if (!audio.value) return
  currentTime.value = audio.value.currentTime
  audioDuration.value = Number.isFinite(audio.value.duration) ? audio.value.duration : 60
}

function seekAudio() {
  if (audio.value) audio.value.currentTime = currentTime.value
}

function changeVolume() {
  if (audio.value) audio.value.volume = volume.value / 100
}

function pauseAudio() {
  playing.value = false
  if (generated.value && currentTime.value > 0 && currentTime.value < audioDuration.value) {
    notice.value = '新音轨已暂停，点击播放继续试听'
  }
}

function pageFromPath(pathname: string): AppPage {
  return /^\/studio\/?$/i.test(pathname) ? 'studio' : 'landing'
}

function updatePageTitle(page: AppPage) {
  document.title = page === 'studio'
    ? 'MoodTrack Studio · AI 音乐创作工作台'
    : 'MoodTrack · 情绪驱动的 AI 音乐'
}

async function navigateToPage(page: AppPage, event?: MouseEvent) {
  if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return
  event?.preventDefault()
  const pathname = page === 'studio' ? '/studio' : '/'
  if (window.location.pathname !== pathname) window.history.pushState({ page }, '', pathname)
  currentPage.value = page
  if (page === 'landing') closeVideo2Music()
  updatePageTitle(page)
  await nextTick()
  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
}

function handlePagePopState() {
  const page = pageFromPath(window.location.pathname)
  currentPage.value = page
  if (page === 'landing') closeVideo2Music()
  updatePageTitle(page)
  void nextTick(() => window.scrollTo({ top: 0, left: 0 }))
}

function scrollToStudio() {
  void navigateToPage('studio')
}

onMounted(async () => {
  updatePageTitle(currentPage.value)
  ;[aceStepOnline.value, gvmgenOnline.value] = await Promise.all([checkAceStepHealth(), checkGvmgenHealth()])
  window.addEventListener('keydown', handleModalKeydown)
  window.addEventListener('popstate', handlePagePopState)
  if (!aceStepOnline.value || !gvmgenOnline.value) {
    healthTimer = window.setInterval(async () => {
      ;[aceStepOnline.value, gvmgenOnline.value] = await Promise.all([
        aceStepOnline.value ? true : checkAceStepHealth(),
        gvmgenOnline.value ? true : checkGvmgenHealth(),
      ])
      if (aceStepOnline.value && gvmgenOnline.value && healthTimer !== null) {
        window.clearInterval(healthTimer)
        healthTimer = null
      }
    }, 5_000)
  }
})

onBeforeUnmount(() => {
  musicRunId += 1
  repaintRunId += 1
  videoRunId += 1
  window.removeEventListener('pointermove', updateFromPointer)
  window.removeEventListener('pointerup', stopDragging)
  window.removeEventListener('keydown', handleModalKeydown)
  window.removeEventListener('popstate', handlePagePopState)
  document.body.classList.remove('modal-open')
  if (healthTimer !== null) window.clearInterval(healthTimer)
  generatedAudioUrls.forEach((url) => URL.revokeObjectURL(url))
  generatedAudioUrls.clear()
  if (videoPreviewUrl.value) URL.revokeObjectURL(videoPreviewUrl.value)
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="MoodTrack 首页" @click="navigateToPage('landing', $event)">
        <span class="brand-mark"><i></i><i></i><i></i><i></i></span>
        <span>MOOD<span>TRACK</span></span>
      </a>
      <nav aria-label="主导航">
        <a href="/" :class="{ active: !isStudioPage }" @click="navigateToPage('landing', $event)">首页</a>
        <a href="/studio" :class="{ active: isStudioPage }" @click="navigateToPage('studio', $event)">创作台</a>
      </nav>
      <div class="top-actions">
        <button class="video-modal-trigger" type="button" @click="openVideo2Music"><span>▶</span> 视频配乐</button>
        <span v-if="isStudioPage" class="save-state"><i></i>{{ notice }}</span>
        <button class="avatar" type="button" aria-label="打开个人菜单">DK</button>
      </div>
    </header>

    <main :id="isStudioPage ? 'studio-top' : 'top'" :class="{ 'studio-page-main': isStudioPage }">
      <section v-if="!isStudioPage" class="hero section-wrap">
        <div class="hero-copy">
          <div class="eyebrow"><span></span> EMOTION-DRIVEN MUSIC ENGINE</div>
          <h1>让每一种情绪，<br><em>都有自己的声音。</em></h1>
          <p>MoodTrack 将你的叙事情绪转译为完整配乐。画出情绪曲线，AI 会理解每一次起伏，并编织成独一无二的音乐。</p>
          <div class="hero-actions">
            <button class="button primary" type="button" @click="scrollToStudio">开始创作 <span>↗</span></button>
            <button class="button hero-secondary" type="button" @click="openVideo2Music">
              <span class="video-tool-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M4 7.5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
                  <path d="m18 11 4-2v8l-4-2" />
                  <path d="M6 4.5h7" />
                </svg>
              </span>
              <span>视频配乐</span>
              <span class="hero-secondary-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
          <div class="trust-row">
            <div><strong>12.8k</strong><span>已生成作品</span></div>
            <div><strong>4.9 / 5</strong><span>创作者评分</span></div>
            <div><strong>60 sec</strong><span>平均生成时间</span></div>
          </div>
        </div>

        <div class="hero-visual" aria-label="情绪转音乐视觉示意">
          <img src="/imgs/hero.png" alt="由蓝紫霓虹声波构成的情绪音乐空间">
          <div class="visual-shade"></div>
          <div class="floating-card visual-status">
            <span>LIVE ANALYSIS</span>
            <strong>陶醉</strong>
            <small>情绪强度 82%</small>
          </div>
          <div class="floating-card visual-note">
            <span class="note-icon">♪</span>
            <div><strong>F minor</strong><small>92 BPM · 4/4</small></div>
          </div>
          <div class="hero-wave">
            <i v-for="(height, index) in waveform.slice(0, 38)" :key="index" :style="{ height: `${height}%` }"></i>
          </div>
        </div>
      </section>

      <Teleport to="body">
        <div v-if="video2MusicOpen" class="video-modal" @click.self="closeVideo2Music">
          <section id="video2music" class="video-lab video-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="video2music-title">
            <button class="video-modal-close" type="button" aria-label="关闭视频配乐弹窗" @click="closeVideo2Music">×</button>
            <div class="video-lab-heading">
              <div>
                <div class="eyebrow"><span></span> MOODTRACK VIDEO SOUNDTRACK</div>
                <h2 id="video2music-title">上传视频，生成并渲染配乐。</h2>
              </div>
              <div class="video-engine-note">
                <strong>MOODTRACK · VIDEO-TO-MUSIC ENGINE</strong>
                <span>SPATIAL ＋ TEMPORAL ALIGNMENT</span>
                <p>视频模型分析画面运动、剪辑与色彩节奏，生成与镜头变化匹配的纯音乐，并输出带配乐视频。</p>
              </div>
            </div>

            <div class="video-lab-grid">
              <section class="video-upload-panel" @dragover.prevent @drop.prevent="handleVideoDrop">
                <input ref="videoInput" class="sr-only" type="file" accept="video/mp4,video/webm,video/quicktime,.mov,.m4v" @change="handleVideoInput">
                <div v-if="videoPreviewUrl" class="video-preview">
                  <video :src="videoPreviewUrl" controls preload="metadata"></video>
                  <button type="button" aria-label="移除视频" @click="clearVideo">×</button>
                  <div><strong>{{ videoFile?.name }}</strong><span>{{ videoFile ? `${(videoFile.size / 1024 / 1024).toFixed(1)} MB` : '' }}</span></div>
                </div>
                <button v-else class="video-dropzone" type="button" @click="chooseVideo">
                  <span class="video-upload-icon">▶</span>
                  <strong>拖入视频，或点击选择</strong>
                  <small>MP4 · WEBM · MOV · 最大 50MB · 最长生成 30 秒</small>
                </button>

                <div class="video-pipeline">
                  <div><span>01</span><strong>SPATIAL SELF</strong><small>提取画面特征</small></div>
                  <i></i>
                  <div><span>02</span><strong>SPATIAL CROSS</strong><small>视觉音乐对齐</small></div>
                  <i></i>
                  <div><span>03</span><strong>TEMPORAL</strong><small>时间结构生成</small></div>
                </div>

                <button v-if="videoFile" class="button video-analyze-button" type="button" :disabled="analyzingVideo || gvmgenGenerating" @click="analyzeSelectedVideo">
                  {{ analyzingVideo ? formatProgressStatus(videoStatus, videoProgress) : videoAnalysis ? '重新预分析' : '预分析画面' }}
                </button>
                <div v-if="analyzingVideo" class="video-progress"><i :style="{ width: `${videoProgress}%` }"></i></div>
                <p v-if="videoError" class="video-error">{{ videoError }}</p>
              </section>

              <section class="video-analysis-panel" :class="{ ready: videoAnalysis }">
                <div class="video-analysis-head">
                  <div><span>VIDEO WORKSPACE</span><h3>{{ videoAnalysis ? '视频已准备好生成' : '等待视频' }}</h3></div>
                  <b>{{ gvmgenOnline ? 'ONLINE' : 'STARTING' }}</b>
                </div>

                <template v-if="videoAnalysis">
                  <div class="video-metrics">
                    <div><span>TEMPO</span><strong>{{ videoAnalysis.bpm }}</strong><small>BPM</small></div>
                    <div><span>MOTION</span><strong>{{ videoAnalysis.motion }}</strong><small>%</small></div>
                    <div><span>CUTS</span><strong>{{ videoAnalysis.cutCount }}</strong><small>STRONG</small></div>
                    <div><span>KEY</span><strong>{{ videoAnalysis.musicKey }}</strong></div>
                  </div>
                  <div class="video-energy-map">
                    <div class="video-map-label"><span>LOCAL VISUAL PREVIEW</span><small>{{ formatTime(videoAnalysis.musicDuration) }}</small></div>
                    <div class="video-energy-bars"><i v-for="(energy, index) in videoAnalysis.energyCurve" :key="index" :style="{ height: `${energy}%` }"></i></div>
                    <div class="video-mood-line"><span v-for="mood in videoAnalysis.moods" :key="`${mood.time}-${mood.label}`"><i></i>{{ mood.label }}</span></div>
                  </div>
                  <div class="video-direction">
                    <div><span>音乐方向</span><strong>{{ videoAnalysis.style }}</strong></div>
                    <div class="video-palette"><i v-for="color in videoAnalysis.palette" :key="color" :style="{ background: color }"></i></div>
                  </div>
                  <p>{{ videoAnalysis.description }}</p>
                  <button class="button video-generate-button" type="button" :disabled="gvmgenGenerating || !gvmgenOnline || generating || repainting" @click="generateVideoMusic">
                    <span>✦</span>{{ !gvmgenOnline ? '视频模型准备中' : gvmgenGenerating ? formatProgressStatus(videoStatus, videoProgress) : '生成配乐并渲染视频' }}
                  </button>
                  <div v-if="gvmgenGenerating" class="video-progress"><i :style="{ width: `${videoProgress}%` }"></i></div>

                  <div v-if="gvmgenResult" class="gvmgen-result">
                    <div class="gvmgen-result-head"><span>OUTPUT READY</span><strong>音乐与视频已对齐</strong></div>
                    <audio :src="gvmgenResult.audioUrl" controls preload="metadata"></audio>
                    <div class="gvmgen-downloads">
                      <a class="primary-output" :href="gvmgenResult.audioUrl" :download="downloadName"><span>♪</span><strong>下载音乐 WAV</strong><small>主要输出</small></a>
                      <a :href="gvmgenResult.videoUrl" :download="renderedVideoDownloadName"><span>▶</span><strong>下载合成视频 MP4</strong><small>带配乐画面</small></a>
                    </div>
                    <video :src="gvmgenResult.videoUrl" controls preload="metadata"></video>
                    <button class="video-show-output" type="button" @click="showVideoOutput()">在主页面查看结果</button>
                  </div>
                </template>

                <div v-else class="video-analysis-empty">
                  <span>⌁</span>
                  <p>选择视频后先在浏览器本地预分析；点击生成时，视频会传给本机视频配乐引擎，生成音乐并自动渲染成片。</p>
                </div>
              </section>
            </div>
          </section>
        </div>
      </Teleport>

      <template v-if="isStudioPage">
      <section id="studio" class="studio studio-page section-wrap">
        <div class="studio-page-heading">
          <div>
            <a class="studio-back-link" href="/" @click="navigateToPage('landing', $event)"><span>←</span> 返回首页</a>
            <div class="eyebrow"><span></span> MOODTRACK CREATIVE STUDIO</div>
            <h1>AI 音乐创作工作台</h1>
            <p>在一个专注的工作空间中设置项目、编辑情绪轨道，并生成可试听、可修改、可导出的完整音乐。</p>
          </div>
          <div class="engine-badge" :class="{ offline: !aceStepOnline }">
            <i></i> MOODTRACK ENGINE <span>{{ aceStepOnline ? 'ONLINE' : 'STARTING' }}</span>
          </div>
        </div>

        <nav class="studio-workspace-nav" aria-label="创作工作区">
          <button type="button" :class="{ active: studioPane === 'create' }" @click="studioPane = 'create'">
            <span>01</span><strong>创作设置</strong><small>PROJECT &amp; EMOTION</small>
          </button>
          <button type="button" :class="{ active: studioPane === 'result' }" @click="studioPane = 'result'">
            <span>02</span><strong>试听与导出</strong><small>{{ generated ? 'OUTPUT READY' : 'COMPOSITION PLAN' }}</small>
            <i v-if="generated" aria-hidden="true"></i>
          </button>
          <button type="button" :class="{ active: studioPane === 'versions' }" :disabled="!trackVersions.length" @click="studioPane = 'versions'">
            <span>03</span><strong>局部修改</strong><small>{{ trackVersions.length ? `${trackVersions.length} VERSION${trackVersions.length > 1 ? 'S' : ''}` : 'GENERATE FIRST' }}</small>
          </button>
        </nav>

        <div v-show="studioPane === 'create'" class="studio-pane studio-create-pane">
        <div class="stepper" aria-label="创作进度">
          <div v-for="step in steps" :key="step.index" class="step" :class="step.state">
            <span>{{ step.index }}</span>
            <strong>{{ step.label }}</strong>
            <i></i>
          </div>
        </div>

        <div class="workspace-grid">
          <section class="panel project-panel">
            <div class="panel-head">
              <div><span>01</span><h3>选择创作场景</h3></div>
              <small>SCENE PRESETS</small>
            </div>

            <div class="preset-grid">
              <button
                v-for="preset in presets"
                :key="preset.id"
                class="preset"
                :class="{ active: activePreset === preset.id, freeform: preset.id === 'freeform' }"
                :aria-pressed="activePreset === preset.id"
                type="button"
                :disabled="generating || repainting"
                @click="applyPreset(preset)"
              >
                <span>{{ preset.emoji }}</span>
                <strong>{{ preset.label }}</strong>
                <small>{{ preset.eyebrow }}</small>
              </button>
            </div>

            <div v-if="isFreeScene" class="freeform-guide" role="status">
              <span>DIRECT PROMPT</span>
              <p>不会套用其他场景的曲风、乐器或编曲结构。直接描述你想要的情绪、风格、节奏、乐器与画面即可。</p>
            </div>

            <div class="form-grid">
              <label class="field full">
                <span>{{ isFreeScene ? '作品名称（可选）' : '作品名称' }}</span>
                <input v-model="title" type="text" :disabled="generating || repainting" :placeholder="isFreeScene ? '例如：雨后的第一班列车' : undefined" @input="invalidateEmotionAnalysis">
              </label>
              <label class="field">
                <span>{{ isFreeScene ? '使用场景（可选）' : '使用场景' }}</span>
                <input v-model="scene" type="text" :disabled="generating || repainting" :placeholder="isFreeScene ? '例如：公路短片片尾' : undefined" @input="invalidateEmotionAnalysis">
              </label>
              <label class="field">
                <span>时长</span>
                <span class="input-unit"><input v-model.number="duration" type="number" min="15" max="180" :disabled="generating || repainting" @change="updateDurationAndEmotionTimeline" @blur="updateDurationAndEmotionTimeline"><b>秒</b></span>
              </label>
              <label class="field full">
                <span>{{ isFreeScene ? '创作 Prompt（必填）' : '音乐方向' }}</span>
                <textarea v-model="style" rows="3" :maxlength="isFreeScene ? 800 : undefined" :disabled="generating || repainting" :placeholder="isFreeScene ? '直接描述想要的音乐，例如：从克制的毛毡钢琴开始，加入雨声与低声弦乐，后半段逐渐明亮，不要鼓组……' : undefined" @input="invalidateEmotionAnalysis"></textarea>
              </label>
            </div>

            <label class="switch-row">
              <span><strong>纯音乐模式</strong><small>不生成人声或歌词</small></span>
              <input v-model="instrumental" type="checkbox" :disabled="generating || repainting" @change="changeMusicMode">
              <i></i>
            </label>

            <div v-if="!instrumental" class="vocal-fields">
              <div class="vocal-mode-head">
                <span>VOCAL MODE</span>
                <small>每次点击生成，MoodTrack 都会自动重写一版不重复歌词</small>
              </div>
              <div class="form-grid">
                <label class="field full">
                  <span>演唱风格</span>
                  <input v-model="vocalStyle" type="text" :disabled="generating || repainting" placeholder="例如：温暖女声、克制主歌、宽阔副歌" @input="generated = false">
                </label>
                <label class="field full">
                  <span>歌词语言</span>
                  <select v-model="vocalLanguage" :disabled="generating || repainting" @change="generated = false">
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                  </select>
                </label>
                <label class="field full">
                  <span>当前歌词 / 下一版避重参考</span>
                  <textarea v-model="lyrics" class="lyrics-input" rows="10" :disabled="generating || repainting" placeholder="每次生成都会自动换成全新歌词；此处内容用于避免下一版重复" @input="generated = false"></textarea>
                </label>
              </div>
            </div>
          </section>

          <section class="panel timeline-panel">
            <div class="panel-head">
              <div><span>02</span><h3>绘制情绪轨道</h3></div>
              <div class="mood-panel-actions">
                <span class="editable-badge"><b aria-hidden="true">✎</b> 名称可编辑</span>
                <button class="add-button" type="button" :disabled="generating || repainting" @click="addMood">＋ 添加节点</button>
              </div>
            </div>
            <p class="panel-intro">拖动图中节点控制时间与情绪强度，AI 会按照曲线组织音乐的能量与结构。</p>

            <label class="emotion-description-field">
              <span>总体情绪描述 <small>TEXT AGENT INPUT</small></span>
              <textarea v-model="emotionDescription" maxlength="1000" rows="3" :disabled="generating || repainting" placeholder="例如：失落但充满希望；雨天的孤独感；平静中带一点期待" @input="invalidateEmotionAnalysis"></textarea>
            </label>

            <div class="chart-shell">
              <div class="chart-axis"><span>强烈</span><span>平静</span></div>
              <div ref="timeline" class="mood-chart" :class="{ dragging: dragging !== null }">
                <div class="chart-grid"></div>
                <div
                  v-for="(point, index) in moods"
                  :key="`${index}-${point.label}`"
                  class="mood-node"
                  :class="{ hot: point.intensity >= 75, active: dragging === index }"
                  :style="{ left: `${(point.time / duration) * 100}%`, top: `${100 - point.intensity}%` }"
                  role="slider"
                  :aria-label="`${point.label}，${point.time}秒，强度${point.intensity}%`"
                  :tabindex="generating || repainting ? -1 : 0"
                  @pointerdown="startDragging(index, $event)"
                >
                  <span>{{ point.label }} · {{ point.intensity }}%</span>
                </div>
              </div>
              <div class="time-axis"><span>0:00</span><span>{{ formatTime(duration / 4) }}</span><span>{{ formatTime(duration / 2) }}</span><span>{{ formatTime(duration * 0.75) }}</span><span>{{ formatTime(duration) }}</span></div>
            </div>

            <p id="mood-edit-hint" class="mood-edit-hint"><span aria-hidden="true">✎</span><strong>可编辑</strong> 点击下方情绪名称修改文字；拖动滑杆调整出现时间与强度。</p>

            <div class="mood-list">
              <div v-for="(point, index) in moods" :key="`row-${index}`" class="mood-row">
                <span class="row-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <div class="mood-name-editor" title="点击编辑情绪名称">
                  <input v-model="point.label" class="mood-name" :aria-label="`第 ${index + 1} 个情绪名称`" aria-describedby="mood-edit-hint" placeholder="输入情绪名称" :disabled="generating || repainting" @input="invalidateEmotionAnalysis">
                  <span class="edit-pencil" aria-hidden="true">✎</span>
                  <small>点击编辑</small>
                </div>
                <label><span>{{ formatTime(point.time) }}</span><input v-model.number="point.time" type="range" min="0" :max="duration" :disabled="generating || repainting" @input="invalidateEmotionAnalysis"></label>
                <label><span>{{ point.intensity }}%</span><input v-model.number="point.intensity" type="range" min="0" max="100" :disabled="generating || repainting" @input="invalidateEmotionAnalysis"></label>
                <button type="button" aria-label="删除节点" :disabled="generating || repainting" @click="removeMood(index)">×</button>
              </div>
            </div>

            <div class="emotion-agent-card" :class="{ ready: currentEmotionAnalysis }">
              <span>TEXT EMOTION AGENT</span>
              <template v-if="currentEmotionAnalysis">
                <strong>{{ currentEmotionAnalysis.fallback ? '保留原始情绪描述' : currentEmotionAnalysis.summary }}</strong>
                <small v-if="currentEmotionAnalysis.fallback">置信度不足，未添加默认情绪，仅使用原始文本引导</small>
                <small v-else>置信度 {{ Math.round(currentEmotionAnalysis.primary.confidence * 100) }}% · 仅使用文本情绪引导</small>
              </template>
              <template v-else>
                <strong>等待分析</strong>
                <small>生成前会归一化自由描述，并将情绪作为文本 Prompt 的一部分</small>
              </template>
            </div>

            <button class="button generate-button" type="button" :disabled="generating || repainting || gvmgenGenerating" @click="generateMusic">
              <span class="spark">✦</span>
              {{ gvmgenGenerating ? formatProgressStatus(videoStatus, videoProgress) : generating ? '正在编织声音…' : repainting ? '正在局部修改…' : videoModeActive ? '重新生成视频配乐' : generated ? (instrumental ? '重新生成配乐' : '重新生成歌曲') : (instrumental ? '生成我的配乐' : '生成人声歌曲') }}
              <small>{{ generating || repainting || gvmgenGenerating ? 'AI PROCESSING' : videoModeActive ? 'VIDEO-TO-MUSIC' : 'ABOUT 60 SECONDS' }}</small>
            </button>
          </section>
        </div>
        </div>
      </section>

      <section v-show="studioPane === 'result'" ref="resultSection" id="how-it-works" class="result-section studio-workspace-pane section-wrap" :class="{ revealed: generated }">
        <div class="result-copy">
          <div class="eyebrow"><span></span> AI COMPOSITION PLAN</div>
          <h2>{{ generated ? '你的声音，已经抵达。' : '先预览 AI 的编曲思路。' }}</h2>
          <p>{{ currentDescription }}</p>
          <div class="plan-stats">
            <div><span>TEMPO</span><strong>{{ currentBpm }}</strong><small>BPM</small></div>
            <div><span>KEY</span><strong>{{ currentMusicKey }}</strong></div>
            <div><span>LENGTH</span><strong>{{ formatTime(duration) }}</strong></div>
            <div><span>EMOTION</span><strong>{{ videoModeActive ? '视觉节奏' : currentEmotionAnalysis ? (currentEmotionAnalysis.fallback ? '原始描述' : currentEmotionAnalysis.primary.labelZh) : '待分析' }}</strong></div>
          </div>
          <div class="instrument-list">
            <span v-for="instrument in currentInstruments" :key="instrument">{{ instrument }}</span>
            <span v-if="!currentInstruments.length">PROMPT DIRECTED</span>
          </div>
        </div>

        <div id="player" class="music-player">
          <div class="player-topline">
            <div class="cover-art"><span>MT</span><i></i></div>
            <div><small>{{ generationNumber ? `NEW TRACK · #${String(generationNumber).padStart(2, '0')} · ${compositionVariant} · ${trackCode}` : 'DEMO PREVIEW' }}</small><h3>{{ title || '自由创作' }}</h3><p>{{ scene || '自定义场景' }} · {{ currentPlanLabel }}</p></div>
            <a :href="audioSource" :download="downloadName" aria-label="下载 WAV 音频">⇩</a>
          </div>

          <div class="waveform" :class="{ playing }">
            <i v-for="(height, index) in waveform" :key="`wave-${index}`" :class="{ passed: index / waveform.length <= currentTime / audioDuration }" :style="{ height: `${height}%`, animationDelay: `${-index * 0.03}s` }"></i>
          </div>

          <input v-model.number="currentTime" class="seek" type="range" min="0" :max="audioDuration || 60" step="0.1" aria-label="播放进度" @input="seekAudio">
          <div class="player-controls">
            <span>{{ formatTime(currentTime) }}</span>
            <div>
              <button type="button" aria-label="后退十秒" @click="currentTime = Math.max(0, currentTime - 10); seekAudio()">−10</button>
              <button class="play-button" type="button" :aria-label="playing ? '暂停' : '播放'" @click="togglePlayback">{{ playing ? 'Ⅱ' : '▶' }}</button>
              <button type="button" aria-label="前进十秒" @click="currentTime = Math.min(audioDuration, currentTime + 10); seekAudio()">+10</button>
            </div>
            <label class="volume">⌁ <input v-model.number="volume" type="range" min="0" max="100" aria-label="音量" @input="changeVolume"></label>
          </div>
          <audio
            :key="audioSource"
            ref="audio"
            :src="audioSource"
            preload="metadata"
            @timeupdate="syncAudio"
            @loadedmetadata="syncAudio"
            @play="playing = true"
            @pause="pauseAudio"
            @ended="playing = false"
          ></audio>
        </div>
      </section>

      <section v-if="gvmgenResult" v-show="studioPane === 'result'" ref="videoOutputSection" id="video-output" class="video-output-section studio-workspace-pane section-wrap">
        <div class="version-heading">
          <div>
            <div class="eyebrow"><span></span> MOODTRACK VIDEO OUTPUT</div>
            <h2>视频配乐已经完成。</h2>
          </div>
          <p>配乐与画面已自动对齐。你可以分别下载无损音乐，或直接下载带配乐的 MP4 成片。</p>
        </div>
        <div class="video-output-grid">
          <div class="video-output-preview">
            <video :src="gvmgenResult.videoUrl" controls preload="metadata"></video>
            <div><strong>{{ videoAnalysis?.sourceName || 'MoodTrack 视频作品' }}</strong><span>{{ videoAnalysis?.style || '视频情绪配乐' }}</span></div>
          </div>
          <div class="gvmgen-result video-output-card">
            <div class="gvmgen-result-head"><span>OUTPUT READY</span><strong>配乐与画面已经对齐</strong></div>
            <audio :src="gvmgenResult.audioUrl" controls preload="metadata"></audio>
            <div class="gvmgen-downloads">
              <a class="primary-output" :href="gvmgenResult.audioUrl" :download="downloadName"><span>♪</span><strong>下载音乐 WAV</strong><small>独立配乐</small></a>
              <a :href="gvmgenResult.videoUrl" :download="renderedVideoDownloadName"><span>▶</span><strong>下载合成视频 MP4</strong><small>带配乐视频</small></a>
            </div>
            <p>{{ videoAnalysis?.description }}</p>
          </div>
        </div>
      </section>

      <section v-if="trackVersions.length" v-show="studioPane === 'versions'" id="version-lab" class="version-lab studio-workspace-pane section-wrap">
        <div class="version-heading">
          <div>
            <div class="eyebrow"><span></span> MOODTRACK REPAINT WORKSPACE</div>
            <h2>局部修改，并排对比每个版本。</h2>
          </div>
          <p>第一次生成会保留为原版。选择时间段并描述修改内容，MoodTrack 只重绘该段，生成的新版本不会覆盖原曲。</p>
        </div>

        <div class="version-grid">
          <section class="revision-panel">
            <div class="version-panel-head">
              <span>01</span>
              <div><small>LOCAL REPAINT</small><h3>选择要修改的片段</h3></div>
            </div>

            <label class="version-field">
              <span>基于版本</span>
              <select v-model.number="sourceVersionIndex" :disabled="generating || repainting" @change="fitEditRangeToSource">
                <option v-for="(version, index) in trackVersions" :key="version.id" :value="index">
                  {{ version.label }} · {{ version.variationName }}
                </option>
              </select>
            </label>

            <div class="range-editor">
              <div class="range-label">
                <span>修改范围</span>
                <strong>{{ formatTime(editStart) }} — {{ formatTime(editEnd) }}</strong>
              </div>
              <label>
                <span>起点</span>
                <input v-model.number="editStart" type="range" min="0" :max="selectedSourceVersion?.duration || duration" step="0.5" :disabled="generating || repainting" @input="normalizeEditRange('start')">
              </label>
              <label>
                <span>终点</span>
                <input v-model.number="editEnd" type="range" min="0.5" :max="selectedSourceVersion?.duration || duration" step="0.5" :disabled="generating || repainting" @input="normalizeEditRange('end')">
              </label>
            </div>

            <label class="version-field">
              <span>这一段怎么改</span>
              <textarea v-model="editInstruction" maxlength="800" rows="5" :disabled="generating || repainting" placeholder="例如：副歌鼓点更有冲击力，保留人声旋律，增加铜管回应和上升感"></textarea>
            </label>

            <label class="strength-field">
              <span>修改幅度 <strong>{{ editStrength }}%</strong></span>
              <input v-model.number="editStrength" type="range" min="5" max="100" step="1" :disabled="generating || repainting">
              <small>低强度更接近原版，高强度会产生更明显的新编曲。</small>
            </label>

            <button class="button revision-button" type="button" :disabled="generating || repainting" @click="repaintMusic">
              <span>✦</span>
              {{ repainting ? 'MoodTrack 正在局部重绘…' : '生成局部修改版本' }}
            </button>
          </section>

          <section class="compare-panel">
            <div class="version-panel-head">
              <span>02</span>
              <div><small>A / B COMPARISON</small><h3>原版与修改版对比</h3></div>
            </div>

            <div class="compare-selectors">
              <label><span>A 版本</span><select v-model.number="compareLeftIndex" :disabled="repainting"><option v-for="(version, index) in trackVersions" :key="`left-${version.id}`" :value="index">{{ version.label }}</option></select></label>
              <label><span>B 版本</span><select v-model.number="compareRightIndex" :disabled="repainting"><option v-for="(version, index) in trackVersions" :key="`right-${version.id}`" :value="index">{{ version.label }}</option></select></label>
            </div>

            <div class="compare-grid">
              <article v-if="compareLeftVersion" class="version-card">
                <div class="version-card-top"><span class="version-badge">A</span><div><strong>{{ compareLeftVersion.label }}</strong><small>{{ compareLeftVersion.variationName }}</small></div></div>
                <p>{{ compareLeftVersion.instruction }}</p>
                <div class="version-meta"><span>{{ formatTime(compareLeftVersion.rangeStart) }}–{{ formatTime(compareLeftVersion.rangeEnd) }}</span><span>{{ formatTime(compareLeftVersion.duration) }}</span></div>
                <audio class="version-audio" :src="compareLeftVersion.audioUrl" controls preload="metadata" @play="pauseOtherVersionAudio"></audio>
                <div class="version-actions"><button type="button" :disabled="repainting" @click="setMainPlayerFromVersion(compareLeftIndex)">设为主播放器</button><a :href="compareLeftVersion.audioUrl" :download="compareLeftVersion.downloadName">下载 WAV</a></div>
              </article>

              <article v-if="trackVersions.length > 1 && compareRightVersion" class="version-card modified">
                <div class="version-card-top"><span class="version-badge">B</span><div><strong>{{ compareRightVersion.label }}</strong><small>{{ compareRightVersion.variationName }}</small></div></div>
                <p>{{ compareRightVersion.instruction }}</p>
                <div class="version-meta"><span>{{ formatTime(compareRightVersion.rangeStart) }}–{{ formatTime(compareRightVersion.rangeEnd) }}</span><span>{{ formatTime(compareRightVersion.duration) }}</span></div>
                <audio class="version-audio" :src="compareRightVersion.audioUrl" controls preload="metadata" @play="pauseOtherVersionAudio"></audio>
                <div class="version-actions"><button type="button" :disabled="repainting" @click="setMainPlayerFromVersion(compareRightIndex)">设为主播放器</button><a :href="compareRightVersion.audioUrl" :download="compareRightVersion.downloadName">下载 WAV</a></div>
              </article>

              <div v-else class="compare-empty">
                <span>＋</span>
                <strong>等待修改版本</strong>
                <p>左侧完成一次局部修改后，原版和新版本会自动放到 A / B 两侧。</p>
              </div>
            </div>
          </section>
        </div>
      </section>
      </template>

      <section v-if="!isStudioPage" id="library" class="footer-cta section-wrap">
        <div><span>ONE CURVE. ENDLESS SOUND.</span><h2>把下一段故事，交给音乐。</h2></div>
        <button class="button primary" type="button" @click="scrollToStudio">创建新作品 <span>↗</span></button>
      </section>
    </main>

    <footer v-if="!isStudioPage">
      <a class="brand" href="/" @click="navigateToPage('landing', $event)"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span>MOOD<span>TRACK</span></span></a>
      <p>Emotion in. Music out.</p>
      <span>© 2026 MOODTRACK</span>
    </footer>
  </div>
</template>
