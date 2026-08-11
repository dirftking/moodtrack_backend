export type VideoMoodPoint = {
  label: string
  time: number
  intensity: number
}

export type VideoMusicAnalysis = {
  sourceName: string
  duration: number
  musicDuration: number
  width: number
  height: number
  bpm: number
  musicKey: string
  brightness: number
  saturation: number
  motion: number
  cutCount: number
  palette: string[]
  moods: VideoMoodPoint[]
  energyCurve: number[]
  instruments: string[]
  style: string
  description: string
  productionPrompt: string
  instrumentalStructure: string
}

type FrameSample = {
  brightness: number
  saturation: number
  warmth: number
  motion: number
  color: [number, number, number]
}

const ANALYSIS_WIDTH = 64
const ANALYSIS_HEIGHT = 36

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function waitFor(target: EventTarget, eventName: string, errorName = 'error', timeout = 15_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('读取视频超时，请尝试 MP4（H.264）格式'))
    }, timeout)
    const cleanup = () => {
      window.clearTimeout(timer)
      target.removeEventListener(eventName, onReady)
      target.removeEventListener(errorName, onError)
    }
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('浏览器无法读取这个视频，请尝试 MP4（H.264）或 WebM 格式'))
    }
    target.addEventListener(eventName, onReady, { once: true })
    target.addEventListener(errorName, onError, { once: true })
  })
}

async function seekVideo(video: HTMLVideoElement, time: number) {
  if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.02) return
  const ready = waitFor(video, 'seeked')
  video.currentTime = time
  await ready
}

function rgbToHex(color: [number, number, number]) {
  return `#${color.map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')}`
}

function frameStatistics(data: Uint8ClampedArray, previousLuma: Float32Array | null): [FrameSample, Float32Array] {
  const pixels = data.length / 4
  const luma = new Float32Array(pixels)
  let red = 0
  let green = 0
  let blue = 0
  let brightness = 0
  let saturation = 0
  let motion = 0

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    const maximum = Math.max(r, g, b)
    const minimum = Math.min(r, g, b)
    const value = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    luma[pixel] = value
    red += r
    green += g
    blue += b
    brightness += value
    saturation += maximum === 0 ? 0 : (maximum - minimum) / maximum
    if (previousLuma) motion += Math.abs(value - previousLuma[pixel])
  }

  const color: [number, number, number] = [red / pixels, green / pixels, blue / pixels]
  return [{
    brightness: brightness / pixels,
    saturation: saturation / pixels,
    warmth: clamp((color[0] - color[2] + 255) / 510, 0, 1),
    motion: previousLuma ? motion / pixels : 0,
    color,
  }, luma]
}

function moodLabel(sample: FrameSample, intensity: number) {
  if (intensity >= 78) return sample.brightness > 0.56 ? '绽放' : '爆发'
  if (sample.motion >= 0.16) return '推进'
  if (sample.brightness < 0.32) return '沉潜'
  if (sample.saturation > 0.42) return '明朗'
  return intensity < 36 ? '平静' : '流动'
}

function frameEnergy(sample: FrameSample) {
  return Math.round(clamp(
    18 + sample.motion * 245 + sample.saturation * 31 + Math.abs(sample.brightness - 0.46) * 18,
    16,
    98,
  ))
}

function pickSample(samples: FrameSample[], ratio: number) {
  return samples[Math.round((samples.length - 1) * ratio)]
}

export async function analyzeVideoFile(
  file: File,
  onProgress?: (progress: number, message: string) => void,
): Promise<VideoMusicAnalysis> {
  const video = document.createElement('video')
  const objectUrl = URL.createObjectURL(file)
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = objectUrl

  try {
    onProgress?.(4, '正在读取视频信息…')
    await waitFor(video, 'loadedmetadata')
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('没有读到有效的视频时长')

    const duration = video.duration
    const musicDuration = clamp(Math.round(duration), 15, 30)
    const sampleCount = clamp(Math.round(duration / 4), 16, 28)
    const canvas = document.createElement('canvas')
    canvas.width = ANALYSIS_WIDTH
    canvas.height = ANALYSIS_HEIGHT
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前浏览器不支持视频画面分析')

    const samples: FrameSample[] = []
    let previousLuma: Float32Array | null = null
    for (let index = 0; index < sampleCount; index += 1) {
      const requestedTime = sampleCount === 1 ? 0 : duration * (index / (sampleCount - 1))
      const safeTime = Math.min(Math.max(0, duration - 0.04), requestedTime)
      await seekVideo(video, safeTime)
      context.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT)
      const image = context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT)
      const [sample, nextLuma] = frameStatistics(image.data, previousLuma)
      samples.push(sample)
      previousLuma = nextLuma
      onProgress?.(8 + Math.round(((index + 1) / sampleCount) * 75), `正在计算事件曲线 ${index + 1}/${sampleCount}…`)
    }

    const average = (key: 'brightness' | 'saturation' | 'warmth' | 'motion') => (
      samples.reduce((total, sample) => total + sample[key], 0) / samples.length
    )
    const brightness = average('brightness')
    const saturation = average('saturation')
    const warmth = average('warmth')
    const motion = samples.slice(1).reduce((total, sample) => total + sample.motion, 0) / Math.max(1, samples.length - 1)
    const cutCount = samples.slice(1).filter((sample) => sample.motion >= 0.22).length
    const cutRate = cutCount / Math.max(1, samples.length - 1)
    const bpm = Math.round(clamp(70 + motion * 260 + cutRate * 52 + saturation * 22, 72, 148))
    const musicKey = brightness > 0.58 && warmth > 0.48 ? 'D major' : brightness < 0.36 ? 'F minor' : warmth > 0.55 ? 'A minor' : 'C minor'
    const energyCurve = samples.map(frameEnergy)
    const moodRatios = [0, 0.34, 0.68, 1]
    const moods = moodRatios.map((ratio) => {
      const sample = pickSample(samples, ratio)
      const intensity = frameEnergy(sample)
      return {
        label: moodLabel(sample, intensity),
        time: Math.round(musicDuration * ratio),
        intensity,
      }
    })

    let instruments: string[]
    let genre: string
    if (motion > 0.16 || cutRate > 0.2) {
      instruments = ['Hybrid Pulse', 'Spiccato Strings', 'Taiko', 'Sub Bass']
      genre = '电影感混合电子 · 动作节奏 · 镜头切点同步'
    } else if (brightness > 0.55 && saturation > 0.35) {
      instruments = ['Glass Pluck', 'Warm Synth', 'Electric Bass', 'Electronic Drums']
      genre = '明亮现代电子 · 流动旋律 · 精准节拍'
    } else if (brightness < 0.36) {
      instruments = ['Dark Pad', 'Felt Piano', 'Cello', 'Low Pulse']
      genre = '氛围电影配乐 · 深色空间 · 克制推进'
    } else {
      instruments = ['Felt Piano', 'Ambient Guitar', 'Chamber Strings', 'Brush Kit']
      genre = '现代叙事配乐 · 温暖质感 · 自然起伏'
    }

    const paletteCandidates = [pickSample(samples, 0.12), pickSample(samples, 0.5), pickSample(samples, 0.88)]
    const palette = [...new Set(paletteCandidates.map((sample) => rgbToHex(sample.color)))]
    const arc = moods.map((mood) => `${mood.time}s ${mood.intensity}% ${mood.label}`).join(', ')
    const description = `从 ${sampleCount} 个时间采样点建立跨帧事件曲线：平均变化 ${Math.round(motion * 100)}%，检测到 ${cutCount} 个强事件边界。音乐将以 ${bpm} BPM 沿着“${moods.map((mood) => mood.label).join(' → ')}”推进，并在画面变化处触发编曲响应。`
    const productionPrompt = `Instrumental cinematic video soundtrack with event-curve conditioning inspired by V2M-Zero: preserve a coherent musical identity while matching when and how strongly the video changes. Synchronize accents, drum density, harmonic transitions and dynamic peaks to the supplied visual event curve and scene boundaries. ${genre}. Visual profile: ${Math.round(brightness * 100)}% brightness, ${Math.round(saturation * 100)}% saturation, ${Math.round(motion * 100)}% average event change, ${cutCount} strong event boundaries. Energy curve: ${arc}. Instruments: ${instruments.join(', ')}. Polished wide mix, precise temporal alignment, no vocals.`
    const instrumentalStructure = `[Intro - establish the global visual tone at ${moods[0].intensity}% energy]\n[Instrumental - follow local motion with precise rhythmic accents]\n[Bridge - transition toward ${moods[2].label} at ${moods[2].intensity}% energy]\n[Instrumental - synchronize the strongest visual moments and cuts]\n[Outro - resolve with the final visual mood, ${moods[3].label}]`

    onProgress?.(96, '正在生成音乐映射…')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
    onProgress?.(100, '视频分析完成')
    return {
      sourceName: file.name,
      duration,
      musicDuration,
      width: video.videoWidth,
      height: video.videoHeight,
      bpm,
      musicKey,
      brightness: Math.round(brightness * 100),
      saturation: Math.round(saturation * 100),
      motion: Math.round(motion * 100),
      cutCount,
      palette,
      moods,
      energyCurve,
      instruments,
      style: genre,
      description,
      productionPrompt,
      instrumentalStructure,
    }
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}
