import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const frontendDirectory = resolve(scriptDirectory, '..')
const sampleRate = 24_000
const duration = 30
const frames = sampleRate * duration

const configurations = {
  joy:       { bpm: 126, root: 261.63, mode: [0, 4, 7, 12], progression: [0, 7, 9, 5], brightness: 0.72, pulse: 0.58, noise: 0.015 },
  sadness:   { bpm: 68,  root: 220.00, mode: [0, 3, 7, 10], progression: [0, 8, 3, 7], brightness: 0.18, pulse: 0.12, noise: 0.010 },
  tension:   { bpm: 132, root: 146.83, mode: [0, 1, 6, 7], progression: [0, 1, 6, 1], brightness: 0.46, pulse: 0.82, noise: 0.060 },
  healing:   { bpm: 72,  root: 293.66, mode: [0, 4, 7, 11], progression: [0, 5, 7, 4], brightness: 0.34, pulse: 0.18, noise: 0.018 },
  calm:      { bpm: 60,  root: 196.00, mode: [0, 7, 12, 16], progression: [0, 5, 0, 7], brightness: 0.12, pulse: 0.06, noise: 0.008 },
  hope:      { bpm: 96,  root: 293.66, mode: [0, 4, 7, 12], progression: [0, 5, 9, 7], brightness: 0.55, pulse: 0.38, noise: 0.012 },
  nostalgia: { bpm: 78,  root: 246.94, mode: [0, 3, 7, 10], progression: [0, 8, 5, 7], brightness: 0.24, pulse: 0.20, noise: 0.025 },
  triumph:   { bpm: 128, root: 174.61, mode: [0, 4, 7, 12], progression: [0, 5, 7, 0], brightness: 0.68, pulse: 0.76, noise: 0.035 },
  mystery:   { bpm: 84,  root: 207.65, mode: [0, 2, 6, 9], progression: [0, 6, 2, 9], brightness: 0.36, pulse: 0.24, noise: 0.030 },
  anger:     { bpm: 150, root: 130.81, mode: [0, 1, 6, 10], progression: [0, 1, 0, 6], brightness: 0.82, pulse: 0.92, noise: 0.085 },
}

function midiRatio(semitones) {
  return 2 ** (semitones / 12)
}

function seededNoise(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff * 2 - 1
  }
}

function oscillator(phase, brightness) {
  const sine = Math.sin(phase)
  const second = Math.sin(phase * 2) * brightness * 0.30
  const third = Math.sin(phase * 3) * brightness * 0.13
  return sine + second + third
}

function synthesize(name, config, seed) {
  const samples = new Float32Array(frames)
  const random = seededNoise(seed)
  const beatSeconds = 60 / config.bpm
  const chordSeconds = beatSeconds * 4
  const padPhases = [0, 0, 0, 0]
  let bassPhase = 0
  let melodyPhase = 0
  let filteredNoise = 0

  for (let index = 0; index < frames; index += 1) {
    const time = index / sampleRate
    const chordIndex = Math.floor(time / chordSeconds) % config.progression.length
    const chordRoot = config.progression[chordIndex]
    const beatPosition = (time / beatSeconds) % 1
    const phrasePosition = (time % chordSeconds) / chordSeconds
    const fade = Math.min(1, time / 0.8, (duration - time) / 1.2)
    let pad = 0

    config.mode.forEach((interval, voice) => {
      const frequency = config.root * midiRatio(chordRoot + interval - (voice === 0 ? 12 : 0))
      padPhases[voice] += 2 * Math.PI * frequency / sampleRate
      const drift = 1 + Math.sin(time * (0.17 + voice * 0.04) + voice) * 0.002
      pad += oscillator(padPhases[voice] * drift, config.brightness) / config.mode.length
    })

    const bassFrequency = config.root * midiRatio(chordRoot - 24)
    bassPhase += 2 * Math.PI * bassFrequency / sampleRate
    const bassEnvelope = Math.exp(-beatPosition * (2.5 + config.pulse * 3.5))
    const bass = Math.sin(bassPhase) * bassEnvelope * (0.12 + config.pulse * 0.16)

    const melodyStep = Math.floor(time / (beatSeconds / 2))
    const melodyInterval = config.mode[(melodyStep + chordIndex) % config.mode.length] + chordRoot + 12
    const melodyFrequency = config.root * midiRatio(melodyInterval)
    melodyPhase += 2 * Math.PI * melodyFrequency / sampleRate
    const melodyEnvelope = Math.exp(-((time / (beatSeconds / 2)) % 1) * (4.5 - config.brightness * 1.5))
    const melody = oscillator(melodyPhase, config.brightness) * melodyEnvelope * (0.035 + config.brightness * 0.055)

    const kickPhase = beatPosition * Math.PI * 2
    const kick = Math.sin(kickPhase * (1.2 + 7 * Math.exp(-beatPosition * 12)))
      * Math.exp(-beatPosition * 18) * config.pulse * 0.20
    filteredNoise += (random() - filteredNoise) * (0.015 + config.brightness * 0.06)
    const air = filteredNoise * config.noise * (0.65 + 0.35 * Math.sin(time * 0.31))
    const tremolo = 0.82 + 0.18 * Math.sin(time * Math.PI * 2 * (name === 'tension' ? 5.5 : 0.12))
    const phraseSwell = 0.78 + 0.22 * Math.sin(Math.PI * phrasePosition)
    const raw = (pad * 0.38 * phraseSwell * tremolo) + bass + melody + kick + air
    samples[index] = Math.tanh(raw * (name === 'anger' ? 1.65 : 1.05)) * fade * 0.82
  }

  return samples
}

function encodeWav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + samples.length * 2, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index += 1) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), 44 + index * 2)
  }
  return bytes
}

for (const [index, [emotion, configuration]] of Object.entries(configurations).entries()) {
  const output = resolve(frontendDirectory, 'emotion-reference-library', 'audio', emotion, 'reference.wav')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, encodeWav(synthesize(emotion, configuration, 0xace500 + index * 7919)))
  console.log(`${emotion}: ${output}`)
}
