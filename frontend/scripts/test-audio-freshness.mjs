import assert from 'node:assert/strict'
import { createServer as createViteServer } from 'vite'

function createWav(durationSeconds, marker) {
  const sampleRate = 8_000
  const channels = 1
  const bitsPerSample = 16
  const dataBytes = Math.round(durationSeconds * sampleRate * channels * bitsPerSample / 8)
  const bytes = Buffer.alloc(44 + dataBytes)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28)
  bytes.writeUInt16LE(channels * bitsPerSample / 8, 32)
  bytes.writeUInt16LE(bitsPerSample, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(dataBytes, 40)
  for (let index = 44; index < bytes.length; index += 2) bytes.writeInt16LE((index * marker) % 32_000, index)
  return new Blob([bytes], { type: 'audio/wav' })
}

const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { validateFreshWav } = await vite.ssrLoadModule('/src/audioValidation.ts')
  const first = await validateFreshWav(createWav(2, 3), 2)
  const second = await validateFreshWav(createWav(2, 7), 2, [first.sha256])
  assert.equal(first.duration, 2)
  assert.equal(second.duration, 2)
  assert.notEqual(first.sha256, second.sha256)

  await assert.rejects(
    () => validateFreshWav(createWav(2, 3), 2, [first.sha256]),
    /旧音频结果/,
  )
  await assert.rejects(() => validateFreshWav(createWav(2, 9), 10), /时长校验失败/)
  await assert.rejects(() => validateFreshWav(new Blob(['not wav'])), /文件过小/)
  console.log('Audio freshness validation test passed.')
} finally {
  await vite.close()
}
