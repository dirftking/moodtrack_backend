<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { checkAceStepHealth, generateAceStepSoundtrack, repaintAceStepSoundtrack } from './aceStepClient'

type MoodPoint = {
  label: string
  time: number
  intensity: number
}

type Preset = {
  id: string
  emoji: string
  label: string
  eyebrow: string
  title: string
  scene: string
  style: string
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
    duration: 60,
    bpm: 92,
    musicKey: 'F minor',
    instruments: ['Juno Pad', 'Rhodes', 'LinnDrum', 'Mono Synth Bass'],
    description: 'Juno 合成器与 Rhodes 铺出夜色，LinnDrum 保持稳定巡航；十六分音符琶音逐步打开，在高潮形成宽阔但克制的霓虹声场。',
    acePrompt: 'Instrumental cinematic synthwave and nocturnal downtempo, dreamy and restrained. Juno-style analog pads, muted Rhodes piano, pulsing mono synth bass, soft LinnDrum kick, gated snare, subtle sixteenth-note arpeggiator and distant neon ambience. Warm tape saturation, wide stereo and a steady night-driving groove. No guitars, orchestral brass, trap hats or vocals.',
    instrumentalStructure: '[Intro - distant analog pads and filtered city ambience]\n[Instrumental - Rhodes motif over restrained drum machine]\n[Bridge - arpeggiator and synth bass grow wider]\n[Instrumental - euphoric neon climax]\n[Outro - drums drop out and warm pads resolve]',
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
]

const activePreset = ref(presets[0].id)
const title = ref(presets[0].title)
const scene = ref(presets[0].scene)
const style = ref(presets[0].style)
const duration = ref(presets[0].duration)
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
const trackVersions = ref<TrackVersion[]>([])
const sourceVersionIndex = ref(0)
const compareLeftIndex = ref(0)
const compareRightIndex = ref(0)
const editStart = ref(12)
const editEnd = ref(30)
const editStrength = ref(65)
const editInstruction = ref('保留主旋律和人声，只增强所选段落的鼓组力度、动态推进和空间层次')
const aceStepOnline = ref(false)
let healthTimer: number | null = null
const sessionCompositionSeed = Math.floor(Math.random() * 10_000)
const resultSection = ref<HTMLElement | null>(null)
const timeline = ref<HTMLElement | null>(null)
const dragging = ref<number | null>(null)

const activePlan = computed(() => presets.find((preset) => preset.id === activePreset.value) ?? presets[0])
const selectedSourceVersion = computed(() => trackVersions.value[sourceVersionIndex.value] ?? trackVersions.value[trackVersions.value.length - 1])
const compareLeftVersion = computed(() => trackVersions.value[compareLeftIndex.value])
const compareRightVersion = computed(() => trackVersions.value[compareRightIndex.value])
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
  duration.value = preset.duration
  vocalStyle.value = preset.vocalStyle
  lyrics.value = preset.defaultLyrics
  moods.value = preset.moods.map((point) => ({ ...point }))
  generated.value = false
  audioSource.value = '/audio/midnight-drive.wav'
  downloadName.value = 'MoodTrack-demo.wav'
  notice.value = `已载入「${preset.label}」场景`
}

function addMood() {
  const lastTime = moods.value.length ? Math.max(...moods.value.map((point) => point.time)) : 0
  moods.value.push({
    label: '新情绪',
    time: Math.min(duration.value, Math.round(lastTime + duration.value * 0.15)),
    intensity: 55,
  })
  generated.value = false
  notice.value = '已添加情绪节点'
}

function removeMood(index: number) {
  if (moods.value.length <= 2) {
    notice.value = '至少保留两个情绪节点'
    return
  }
  moods.value.splice(index, 1)
  generated.value = false
  notice.value = '已移除情绪节点'
}

function updateFromPointer(event: PointerEvent) {
  if (dragging.value === null || !timeline.value) return
  const point = moods.value[dragging.value]
  if (!point) return
  const rect = timeline.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
  point.time = Math.round((x / rect.width) * duration.value)
  point.intensity = Math.round(100 - (y / rect.height) * 100)
  generated.value = false
}

function stopDragging() {
  dragging.value = null
  window.removeEventListener('pointermove', updateFromPointer)
  window.removeEventListener('pointerup', stopDragging)
  notice.value = '情绪曲线已更新'
}

function startDragging(index: number, event: PointerEvent) {
  dragging.value = index
  event.preventDefault()
  window.addEventListener('pointermove', updateFromPointer)
  window.addEventListener('pointerup', stopDragging, { once: true })
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

function changeMusicMode() {
  generated.value = false
  notice.value = instrumental.value ? '已切换为纯音乐模式' : '已启用 HeartArt 人声歌曲模式'
}

async function generateMusic() {
  if (generating.value || repainting.value) return
  if (!instrumental.value && !lyrics.value.trim()) {
    notice.value = '人声歌曲模式需要填写歌词'
    return
  }
  generating.value = true
  generated.value = false
  playing.value = false
  audio.value?.pause()
  notice.value = '正在理解情绪曲线并组织声音…'

  try {
    const nextGeneration = generationNumber.value + 1
    const variation = sessionCompositionSeed + nextGeneration
    const result = await generateAceStepSoundtrack({
      title: title.value,
      scene: scene.value,
      style: style.value,
      instruments: activePlan.value.instruments,
      productionPrompt: activePlan.value.acePrompt,
      instrumentalStructure: activePlan.value.instrumentalStructure,
      presetId: activePreset.value,
      musicKey: activePlan.value.musicKey,
      bpm: activePlan.value.bpm,
      duration: duration.value,
      moods: moods.value,
      instrumental: instrumental.value,
      vocalStyle: vocalStyle.value,
      vocalLanguage: vocalLanguage.value,
      lyrics: lyrics.value,
      variation,
      onStatus(message) {
        notice.value = message
      },
      onLyricsGenerated(nextLyrics) {
        lyrics.value = nextLyrics
        notice.value = '全新歌词已写好，正在交给 HeartArt 编曲演唱…'
      },
    })

    const generatedAudioUrl = URL.createObjectURL(result.audio)
    generatedAudioUrls.add(generatedAudioUrl)
    audioSource.value = generatedAudioUrl
    generationNumber.value = nextGeneration
    trackCode.value = `HA-${result.taskId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
    compositionVariant.value = result.variationName
    const waveformSeed = [...result.taskId].reduce((total, character) => total + character.charCodeAt(0), 0)
    waveform.value = createWaveform(waveformSeed)
    const nextDownloadName = `${title.value.trim() || 'MoodTrack'}-${trackCode.value}.wav`
    downloadName.value = nextDownloadName
    currentTime.value = 0
    audioDuration.value = result.duration
    generated.value = true
    aceStepOnline.value = true

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
        notice.value = 'HeartArt 新音轨已生成，正在播放'
      } catch {
        notice.value = 'HeartArt 新音轨已生成，点击播放即可试听'
      }
    }
    resultSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    console.error('Failed to generate soundtrack', error)
    aceStepOnline.value = await checkAceStepHealth()
    notice.value = error instanceof Error ? error.message : 'HeartArt 生成失败，请稍后重试'
  } finally {
    generating.value = false
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
  const version = trackVersions.value[index]
  if (!version) return
  document.querySelectorAll<HTMLAudioElement>('.version-audio').forEach((item) => item.pause())
  audio.value?.pause()
  sourceVersionIndex.value = index
  audioSource.value = version.audioUrl
  downloadName.value = version.downloadName
  trackCode.value = `HA-${version.taskId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
  compositionVariant.value = version.variationName
  currentTime.value = 0
  audioDuration.value = version.duration
  generated.value = true
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
  if (generating.value || repainting.value) return
  const source = selectedSourceVersion.value
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
  playing.value = false
  audio.value?.pause()
  document.querySelectorAll<HTMLAudioElement>('.version-audio').forEach((item) => item.pause())

  try {
    const result = await repaintAceStepSoundtrack({
      sourceFile: source.sourceFile,
      prompt: editInstruction.value.trim(),
      lyrics: source.lyrics,
      instrumental: instrumental.value,
      vocalLanguage: vocalLanguage.value,
      bpm: activePlan.value.bpm,
      musicKey: activePlan.value.musicKey,
      duration: source.duration,
      start,
      end,
      strength: editStrength.value / 100,
      onStatus(message) {
        notice.value = message
      },
    })

    const generatedAudioUrl = URL.createObjectURL(result.audio)
    generatedAudioUrls.add(generatedAudioUrl)
    const nextGeneration = generationNumber.value + 1
    const nextTrackCode = `HA-${result.taskId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
    const nextDownloadName = `${title.value.trim() || 'MoodTrack'}-${nextTrackCode}.wav`
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
      instruction: editInstruction.value.trim(),
      rangeStart: start,
      rangeEnd: end,
      lyrics: result.lyrics,
    })

    compareLeftIndex.value = sourceVersionIndex.value
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
    console.error('Failed to repaint soundtrack', error)
    aceStepOnline.value = await checkAceStepHealth()
    notice.value = error instanceof Error ? error.message : 'HeartArt 局部修改失败，请稍后重试'
  } finally {
    repainting.value = false
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

function scrollToStudio() {
  document.querySelector('#studio')?.scrollIntoView({ behavior: 'smooth' })
}

onMounted(async () => {
  aceStepOnline.value = await checkAceStepHealth()
  if (!aceStepOnline.value) {
    healthTimer = window.setInterval(async () => {
      aceStepOnline.value = await checkAceStepHealth()
      if (aceStepOnline.value && healthTimer !== null) {
        window.clearInterval(healthTimer)
        healthTimer = null
      }
    }, 10_000)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', updateFromPointer)
  window.removeEventListener('pointerup', stopDragging)
  if (healthTimer !== null) window.clearInterval(healthTimer)
  generatedAudioUrls.forEach((url) => URL.revokeObjectURL(url))
  generatedAudioUrls.clear()
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#top" aria-label="MoodTrack 首页">
        <span class="brand-mark"><i></i><i></i><i></i><i></i></span>
        <span>MOOD<span>TRACK</span></span>
      </a>
      <nav aria-label="主导航">
        <a class="active" href="#studio">创作台</a>
        <a href="#how-it-works">工作原理</a>
        <a href="#library">灵感库</a>
      </nav>
      <div class="top-actions">
        <span class="save-state"><i></i>{{ notice }}</span>
        <button class="avatar" type="button" aria-label="打开个人菜单">DK</button>
      </div>
    </header>

    <main id="top">
      <section class="hero section-wrap">
        <div class="hero-copy">
          <div class="eyebrow"><span></span> EMOTION-DRIVEN MUSIC ENGINE</div>
          <h1>让每一种情绪，<br><em>都有自己的声音。</em></h1>
          <p>MoodTrack 将你的叙事情绪转译为完整配乐。画出情绪曲线，AI 会理解每一次起伏，并编织成独一无二的音乐。</p>
          <div class="hero-actions">
            <button class="button primary" type="button" @click="scrollToStudio">开始创作 <span>↗</span></button>
            <a class="button text-button" href="#player">试听示例 <span class="mini-play">▶</span></a>
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

      <section id="studio" class="studio section-wrap">
        <div class="section-heading">
          <div>
            <div class="eyebrow"><span></span> CREATIVE WORKSPACE</div>
            <h2>声音，从一条情绪曲线开始</h2>
          </div>
          <div class="engine-badge" :class="{ offline: !aceStepOnline }">
            <i></i> HEARTART ENGINE <span>{{ aceStepOnline ? 'ONLINE' : 'STARTING' }}</span>
          </div>
        </div>

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
                :class="{ active: activePreset === preset.id }"
                type="button"
                @click="applyPreset(preset)"
              >
                <span>{{ preset.emoji }}</span>
                <strong>{{ preset.label }}</strong>
                <small>{{ preset.eyebrow }}</small>
              </button>
            </div>

            <div class="form-grid">
              <label class="field full">
                <span>作品名称</span>
                <input v-model="title" type="text" @input="generated = false">
              </label>
              <label class="field">
                <span>使用场景</span>
                <input v-model="scene" type="text" @input="generated = false">
              </label>
              <label class="field">
                <span>时长</span>
                <span class="input-unit"><input v-model.number="duration" type="number" min="15" max="180" @input="generated = false"><b>秒</b></span>
              </label>
              <label class="field full">
                <span>音乐方向</span>
                <textarea v-model="style" rows="3" @input="generated = false"></textarea>
              </label>
            </div>

            <label class="switch-row">
              <span><strong>纯音乐模式</strong><small>不生成人声或歌词</small></span>
              <input v-model="instrumental" type="checkbox" @change="changeMusicMode">
              <i></i>
            </label>

            <div v-if="!instrumental" class="vocal-fields">
              <div class="vocal-mode-head">
                <span>VOCAL MODE</span>
                <small>每次点击生成，HeartArt 都会自动重写一版不重复歌词</small>
              </div>
              <div class="form-grid">
                <label class="field full">
                  <span>演唱风格</span>
                  <input v-model="vocalStyle" type="text" placeholder="例如：温暖女声、克制主歌、宽阔副歌" @input="generated = false">
                </label>
                <label class="field full">
                  <span>歌词语言</span>
                  <select v-model="vocalLanguage" @change="generated = false">
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                  </select>
                </label>
                <label class="field full">
                  <span>当前歌词 / 下一版避重参考</span>
                  <textarea v-model="lyrics" class="lyrics-input" rows="10" placeholder="每次生成都会自动换成全新歌词；此处内容用于避免下一版重复" @input="generated = false"></textarea>
                </label>
              </div>
            </div>
          </section>

          <section class="panel timeline-panel">
            <div class="panel-head">
              <div><span>02</span><h3>绘制情绪轨道</h3></div>
              <button class="add-button" type="button" @click="addMood">＋ 添加节点</button>
            </div>
            <p class="panel-intro">拖动节点控制时间与情绪强度，AI 会按照曲线组织音乐的能量与结构。</p>

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
                  tabindex="0"
                  @pointerdown="startDragging(index, $event)"
                >
                  <span>{{ point.label }} · {{ point.intensity }}%</span>
                </div>
              </div>
              <div class="time-axis"><span>0:00</span><span>{{ formatTime(duration / 4) }}</span><span>{{ formatTime(duration / 2) }}</span><span>{{ formatTime(duration * 0.75) }}</span><span>{{ formatTime(duration) }}</span></div>
            </div>

            <div class="mood-list">
              <div v-for="(point, index) in moods" :key="`row-${index}`" class="mood-row">
                <span class="row-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <input v-model="point.label" class="mood-name" aria-label="情绪名称" @input="generated = false">
                <label><span>{{ formatTime(point.time) }}</span><input v-model.number="point.time" type="range" min="0" :max="duration" @input="generated = false"></label>
                <label><span>{{ point.intensity }}%</span><input v-model.number="point.intensity" type="range" min="0" max="100" @input="generated = false"></label>
                <button type="button" aria-label="删除节点" @click="removeMood(index)">×</button>
              </div>
            </div>

            <button class="button generate-button" type="button" :disabled="generating || repainting" @click="generateMusic">
              <span class="spark">✦</span>
              {{ generating ? '正在编织声音…' : repainting ? '正在局部修改…' : generated ? (instrumental ? '重新生成配乐' : '重新生成歌曲') : (instrumental ? '生成我的配乐' : '生成人声歌曲') }}
              <small>{{ generating || repainting ? 'HEARTART PROCESSING' : 'ABOUT 60 SECONDS' }}</small>
            </button>
          </section>
        </div>
      </section>

      <section ref="resultSection" id="how-it-works" class="result-section section-wrap" :class="{ revealed: generated }">
        <div class="result-copy">
          <div class="eyebrow"><span></span> AI COMPOSITION PLAN</div>
          <h2>{{ generated ? '你的声音，已经抵达。' : '先预览 AI 的编曲思路。' }}</h2>
          <p>{{ activePlan.description }}</p>
          <div class="plan-stats">
            <div><span>TEMPO</span><strong>{{ activePlan.bpm }}</strong><small>BPM</small></div>
            <div><span>KEY</span><strong>{{ activePlan.musicKey }}</strong></div>
            <div><span>LENGTH</span><strong>{{ formatTime(duration) }}</strong></div>
          </div>
          <div class="instrument-list">
            <span v-for="instrument in activePlan.instruments" :key="instrument">{{ instrument }}</span>
          </div>
        </div>

        <div id="player" class="music-player">
          <div class="player-topline">
            <div class="cover-art"><span>MT</span><i></i></div>
            <div><small>{{ generationNumber ? `NEW TRACK · #${String(generationNumber).padStart(2, '0')} · ${compositionVariant} · ${trackCode}` : 'DEMO PREVIEW' }}</small><h3>{{ title }}</h3><p>{{ scene }} · {{ activePlan.label }}</p></div>
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

      <section v-if="trackVersions.length" id="version-lab" class="version-lab section-wrap">
        <div class="version-heading">
          <div>
            <div class="eyebrow"><span></span> HEARTART REPAINT WORKSPACE</div>
            <h2>局部修改，并排对比每个版本。</h2>
          </div>
          <p>第一次生成会保留为原版。选择时间段并描述修改内容，HeartArt 只重绘该段，生成的新版本不会覆盖原曲。</p>
        </div>

        <div class="version-grid">
          <section class="revision-panel">
            <div class="version-panel-head">
              <span>01</span>
              <div><small>LOCAL REPAINT</small><h3>选择要修改的片段</h3></div>
            </div>

            <label class="version-field">
              <span>基于版本</span>
              <select v-model.number="sourceVersionIndex" @change="fitEditRangeToSource">
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
                <input v-model.number="editStart" type="range" min="0" :max="selectedSourceVersion?.duration || duration" step="0.5" @input="normalizeEditRange('start')">
              </label>
              <label>
                <span>终点</span>
                <input v-model.number="editEnd" type="range" min="0.5" :max="selectedSourceVersion?.duration || duration" step="0.5" @input="normalizeEditRange('end')">
              </label>
            </div>

            <label class="version-field">
              <span>这一段怎么改</span>
              <textarea v-model="editInstruction" maxlength="800" rows="5" placeholder="例如：副歌鼓点更有冲击力，保留人声旋律，增加铜管回应和上升感"></textarea>
            </label>

            <label class="strength-field">
              <span>修改幅度 <strong>{{ editStrength }}%</strong></span>
              <input v-model.number="editStrength" type="range" min="5" max="100" step="1">
              <small>低强度更接近原版，高强度会产生更明显的新编曲。</small>
            </label>

            <button class="button revision-button" type="button" :disabled="generating || repainting" @click="repaintMusic">
              <span>✦</span>
              {{ repainting ? 'HeartArt 正在局部重绘…' : '生成局部修改版本' }}
            </button>
          </section>

          <section class="compare-panel">
            <div class="version-panel-head">
              <span>02</span>
              <div><small>A / B COMPARISON</small><h3>原版与修改版对比</h3></div>
            </div>

            <div class="compare-selectors">
              <label><span>A 版本</span><select v-model.number="compareLeftIndex"><option v-for="(version, index) in trackVersions" :key="`left-${version.id}`" :value="index">{{ version.label }}</option></select></label>
              <label><span>B 版本</span><select v-model.number="compareRightIndex"><option v-for="(version, index) in trackVersions" :key="`right-${version.id}`" :value="index">{{ version.label }}</option></select></label>
            </div>

            <div class="compare-grid">
              <article v-if="compareLeftVersion" class="version-card">
                <div class="version-card-top"><span class="version-badge">A</span><div><strong>{{ compareLeftVersion.label }}</strong><small>{{ compareLeftVersion.variationName }}</small></div></div>
                <p>{{ compareLeftVersion.instruction }}</p>
                <div class="version-meta"><span>{{ formatTime(compareLeftVersion.rangeStart) }}–{{ formatTime(compareLeftVersion.rangeEnd) }}</span><span>{{ formatTime(compareLeftVersion.duration) }}</span></div>
                <audio class="version-audio" :src="compareLeftVersion.audioUrl" controls preload="metadata" @play="pauseOtherVersionAudio"></audio>
                <div class="version-actions"><button type="button" @click="setMainPlayerFromVersion(compareLeftIndex)">设为主播放器</button><a :href="compareLeftVersion.audioUrl" :download="compareLeftVersion.downloadName">下载 WAV</a></div>
              </article>

              <article v-if="trackVersions.length > 1 && compareRightVersion" class="version-card modified">
                <div class="version-card-top"><span class="version-badge">B</span><div><strong>{{ compareRightVersion.label }}</strong><small>{{ compareRightVersion.variationName }}</small></div></div>
                <p>{{ compareRightVersion.instruction }}</p>
                <div class="version-meta"><span>{{ formatTime(compareRightVersion.rangeStart) }}–{{ formatTime(compareRightVersion.rangeEnd) }}</span><span>{{ formatTime(compareRightVersion.duration) }}</span></div>
                <audio class="version-audio" :src="compareRightVersion.audioUrl" controls preload="metadata" @play="pauseOtherVersionAudio"></audio>
                <div class="version-actions"><button type="button" @click="setMainPlayerFromVersion(compareRightIndex)">设为主播放器</button><a :href="compareRightVersion.audioUrl" :download="compareRightVersion.downloadName">下载 WAV</a></div>
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

      <section id="library" class="footer-cta section-wrap">
        <div><span>ONE CURVE. ENDLESS SOUND.</span><h2>把下一段故事，交给音乐。</h2></div>
        <button class="button primary" type="button" @click="scrollToStudio">创建新作品 <span>↗</span></button>
      </section>
    </main>

    <footer>
      <a class="brand" href="#top"><span class="brand-mark"><i></i><i></i><i></i><i></i></span><span>MOOD<span>TRACK</span></span></a>
      <p>Emotion in. Music out.</p>
      <span>© 2026 MOODTRACK</span>
    </footer>
  </div>
</template>
