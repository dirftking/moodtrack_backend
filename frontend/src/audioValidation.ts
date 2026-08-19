export type ValidatedAudio = {
  duration: number
  sha256: string
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function wavDuration(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('MoodTrack 返回的文件不是有效 WAV 音频')
  }

  const view = new DataView(buffer)
  let offset = 12
  let byteRate = 0
  let dataBytes = 0
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(bytes, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const dataOffset = offset + 8
    if (dataOffset + chunkSize > bytes.length) break
    if (chunkId === 'fmt ' && chunkSize >= 16) byteRate = view.getUint32(dataOffset + 8, true)
    if (chunkId === 'data') {
      dataBytes = chunkSize
      break
    }
    offset = dataOffset + chunkSize + (chunkSize % 2)
  }
  if (!byteRate || !dataBytes) throw new Error('MoodTrack 返回的 WAV 音频结构不完整')
  return dataBytes / byteRate
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export async function validateFreshWav(
  audio: Blob,
  expectedDuration: number,
  excludedDigests: Iterable<string> = [],
): Promise<ValidatedAudio> {
  if (audio.size < 1_024) throw new Error('MoodTrack 返回的音频文件过小，已拒绝使用旧结果或损坏文件')
  const buffer = await audio.arrayBuffer()
  const duration = wavDuration(buffer)
  const tolerance = Math.max(1.5, expectedDuration * 0.08)
  if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - expectedDuration) > tolerance) {
    throw new Error(`MoodTrack 音频时长校验失败：需要约 ${Math.round(expectedDuration)} 秒，实际 ${duration.toFixed(1)} 秒`)
  }
  const digest = await sha256(buffer)
  if (new Set(excludedDigests).has(digest)) {
    throw new Error('MoodTrack 检测到旧音频结果，已阻止覆盖；请重新生成')
  }
  return { duration, sha256: digest }
}
