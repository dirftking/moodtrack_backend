import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer } from 'vite'

const tinyAudioBytes = Buffer.alloc(44 + 10 * 8_000 * 2)
tinyAudioBytes.write('RIFF', 0, 'ascii')
tinyAudioBytes.writeUInt32LE(tinyAudioBytes.length - 8, 4)
tinyAudioBytes.write('WAVE', 8, 'ascii')
tinyAudioBytes.write('fmt ', 12, 'ascii')
tinyAudioBytes.writeUInt32LE(16, 16)
tinyAudioBytes.writeUInt16LE(1, 20)
tinyAudioBytes.writeUInt16LE(1, 22)
tinyAudioBytes.writeUInt32LE(8_000, 24)
tinyAudioBytes.writeUInt32LE(16_000, 28)
tinyAudioBytes.writeUInt16LE(2, 32)
tinyAudioBytes.writeUInt16LE(16, 34)
tinyAudioBytes.write('data', 36, 'ascii')
tinyAudioBytes.writeUInt32LE(tinyAudioBytes.length - 44, 40)

function json(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const scratch = await mkdtemp(join(tmpdir(), 'moodtrack-local-adapter-test-'))
const audioRoot = join(scratch, 'api_audio')
await mkdir(audioRoot, { recursive: true })

const submitted = []
const sampleRequests = []
const taskResults = new Map()
const generatedAudioBytes = []
const localServer = createHttpServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, {
      data: {
        status: 'ok',
        service: 'ACE-Step API',
        models_initialized: true,
        llm_initialized: true,
        loaded_model: 'acestep-v15-turbo',
        loaded_lm_model: 'acestep-5Hz-lm-1.7B',
      },
      code: 200,
      error: null,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/create_sample') {
    const body = await readJson(request)
    sampleRequests.push(body)
    const retryAttempt = sampleRequests.filter((item) => String(item.query).includes('force-language-retry')).length
    const lyrics = retryAttempt === 1
      ? '[Verse]\n夜色里继续向前 하지만 mixed language should be rejected'
      : retryAttempt > 1
        ? '[Verse]\n夜色轻轻落在窗前\n我沿著微光繼續向前\n心里始终留着希望'
        : '[Verse 1]\nA newly generated local lyric moves through midnight streets\n[Chorus]\nI follow a new light into hopeful dawn'
    json(response, 200, {
      data: {
        caption: 'CONFLICTING_GUITAR male vocal and orchestral impact that must not alter the music prompt',
        lyrics,
        bpm: 140,
        duration: 147,
        keyscale: 'D Major',
        timesignature: '4',
        vocal_language: 'en',
      },
      code: 200,
      error: null,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/release_task') {
    const body = await readJson(request)
    submitted.push(body)
    const taskId = randomUUID()
    const outputPath = join(audioRoot, `${taskId}.wav`)
    const outputBytes = Buffer.from(tinyAudioBytes)
    outputBytes.writeInt16LE(submitted.length, 44)
    await writeFile(outputPath, outputBytes)
    generatedAudioBytes.push(outputBytes)
    const lyrics = body.task_type === 'repaint'
      ? 'Upstream must not replace preserved source lyrics'
      : body.lyrics
    taskResults.set(taskId, JSON.stringify([{
      file: `/v1/audio?path=${encodeURIComponent(outputPath)}`,
      status: 1,
      seed_value: String(submitted.length),
      dit_model: 'acestep-v15-turbo',
      lm_model: body.sample_mode ? 'acestep-5Hz-lm-1.7B' : '',
      lyrics,
      metas: { duration: 10, bpm: body.bpm, keyscale: body.key_scale, timesignature: '4' },
    }]))
    json(response, 200, {
      data: { task_id: taskId, status: 'queued', queue_position: 1 },
      code: 200,
      error: null,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/query_result') {
    const body = await readJson(request)
    const taskId = body.task_id_list?.[0]
    json(response, 200, {
      data: [{ task_id: taskId, status: 1, result: taskResults.get(taskId) }],
      code: 200,
      error: null,
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/v1/audio') {
    let bytes
    try {
      bytes = await readFile(url.searchParams.get('path'))
    } catch {
      json(response, 404, { detail: 'audio not found' })
      return
    }
    response.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': bytes.length,
    })
    response.end(bytes)
    return
  }

  json(response, 404, { detail: 'not found' })
})

localServer.listen(0, '127.0.0.1')
await once(localServer, 'listening')
const localAddress = localServer.address()
assert(localAddress && typeof localAddress === 'object')

process.env.ACESTEP_PROVIDER = 'local'
process.env.ACESTEP_LOCAL_API_URL = `http://127.0.0.1:${localAddress.port}`
process.env.ACESTEP_LOCAL_AUDIO_ROOT = audioRoot

const vite = await createViteServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'silent',
})

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: JSON.stringify(body),
  })
  const nextCookie = response.headers.get('set-cookie')?.split(';')[0]
  if (nextCookie) sessionCookie = nextCookie
  const payload = await response.json()
  assert.equal(response.ok, true, payload.error || `HTTP ${response.status}`)
  assert.equal(payload.code, 200)
  return payload.data
}

let sessionCookie = ''

async function waitForTask(baseUrl, taskId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tasks = await post(baseUrl, '/ace-step/query_result', { task_id_list: [taskId] })
    if (tasks[0]?.status === 1) return JSON.parse(tasks[0].result)
    if (tasks[0]?.status === 2) throw new Error(tasks[0].error)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Mock local task timed out')
}

try {
  await vite.listen()
  const viteAddress = vite.httpServer?.address()
  assert(viteAddress && typeof viteAddress === 'object')
  const baseUrl = `http://127.0.0.1:${viteAddress.port}`

  for (const privatePath of [
    '/emotion-reference-library/manifest.json',
    '/emotion-reference-library/audio/hope/reference.wav',
  ]) {
    const privateResponse = await fetch(`${baseUrl}${privatePath}`)
    assert.equal(privateResponse.status, 404, `${privatePath} must remain server-only`)
  }

  const healthResponse = await fetch(`${baseUrl}/ace-step/health`)
  assert.equal(healthResponse.status, 200)
  const health = await healthResponse.json()
  assert.equal(health.data.status, 'ok')
  assert.equal(health.data.service, 'ACE-Step Local API')
  assert.equal(health.data.text_agent, 'moodtrack-text-agent-v1')
  assert.equal(health.data.emotion_reference_categories, 0)
  assert.equal(health.data.reference_audio_enabled, false)

  const classified = await post(baseUrl, '/ace-step/emotions/classify', {
    description: '失落但充满希望',
    duration: 10,
    moods: [
      { label: '失落', time: 0, intensity: 58 },
      { label: '希望', time: 6, intensity: 82 },
    ],
  })
  assert.equal(classified.primary.id, 'hope')
  assert.equal(classified.referenceEmotionId, null)
  assert.equal(classified.reference, null)

  const created = await post(baseUrl, '/ace-step/release_task', {
    task_type: 'text2music',
    prompt: 'FREEFORM-DIRECT-PROMPT FREEFORM-END',
    lyrics: '',
    sample_mode: true,
    sample_query: 'Write a completely new English song',
    instrumental: false,
    vocal_language: 'en',
    bpm: 0,
    key_scale: '',
    audio_duration: 10,
    reference_emotion_id: 'hope',
    emotion_context: {
      description: '失落但充满希望',
      duration: 10,
      moods: [],
    },
  })
  const files = await waitForTask(baseUrl, created.task_id)
  assert.match(files[0].lyrics, /newly generated local lyric/i)
  assert.equal(files[0].emotion_analysis.primary.id, 'hope')
  assert.equal(files[0].reference_audio, null)
  assert.match(files[0].moodtrack_audio_digest, /^[a-f0-9]{64}$/)
  assert.equal(files[0].moodtrack_audio_duration, 10)

  const vocalRequest = submitted[0]
  assert.equal(sampleRequests.length, 1)
  assert.match(sampleRequests[0].query, /^Write a completely new English song/)
  assert.match(sampleRequests[0].query, /STRICT: Output only English lyrics/)
  assert.equal(vocalRequest.sample_mode, false)
  assert.equal(vocalRequest.sample_query, '')
  assert.equal(vocalRequest.thinking, true)
  assert.equal(vocalRequest.use_cot_caption, false)
  assert.equal(vocalRequest.use_cot_language, false)
  assert.equal(vocalRequest.inference_steps, 8)
  assert.equal(vocalRequest.use_random_seed, true)
  assert.match(vocalRequest.lyrics, /newly generated local lyric/i)
  assert.equal(vocalRequest.audio_duration, 10)
  assert.match(vocalRequest.prompt, /^FREEFORM-DIRECT-PROMPT FREEFORM-END(?:\s|$)/)
  assert.doesNotMatch(vocalRequest.prompt, /CONFLICTING_GUITAR|male vocal|orchestral impact/i)
  assert.doesNotMatch(vocalRequest.prompt, /Rhodes|night-driving|epic battle|product reveal/i)
  assert.equal(vocalRequest.bpm, 0)
  assert.equal(vocalRequest.key_scale, '')
  assert.equal(vocalRequest.model, 'acestep-v15-turbo')
  assert.equal(Object.prototype.hasOwnProperty.call(vocalRequest, 'reference_audio_path'), false)

  const audioJoiner = files[0].file.includes('?') ? '&' : '?'
  const audioResponse = await fetch(`${baseUrl}/ace-step${files[0].file}${audioJoiner}moodtrack_task=${created.task_id}`, {
    headers: { Cookie: sessionCookie },
  })
  const audioError = audioResponse.ok ? '' : await audioResponse.clone().text()
  assert.equal(audioResponse.status, 200, audioError)
  assert.match(audioResponse.headers.get('cache-control') || '', /no-store/)
  assert.equal(audioResponse.headers.get('pragma'), 'no-cache')
  assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), generatedAudioBytes[0])

  const foreignTaskResponse = await fetch(`${baseUrl}/ace-step/query_result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ task_id_list: [randomUUID()] }),
  })
  assert.equal(foreignTaskResponse.status, 404)

  const otherSessionResponse = await fetch(`${baseUrl}/ace-step/query_result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id_list: [created.task_id] }),
  })
  assert.equal(otherSessionResponse.status, 404)

  const preservedLyrics = files[0].lyrics
  const repaint = await post(baseUrl, '/ace-step/release_task', {
    task_type: 'repaint',
    source_task_id: created.task_id,
    prompt: 'Strengthen drums inside the selected range',
    lyrics: preservedLyrics,
    instrumental: false,
    vocal_language: 'en',
    source_file: files[0].file,
    bpm: 120,
    key_scale: 'C Major',
    audio_duration: 10,
    repainting_start: 2,
    repainting_end: 6,
    repaint_strength: 0.6,
    reference_emotion_id: 'hope',
  })
  const repaintFiles = await waitForTask(baseUrl, repaint.task_id)
  assert.equal(repaintFiles[0].lyrics, preservedLyrics)
  assert.doesNotMatch(repaintFiles[0].lyrics, /must not replace/i)
  assert.equal(repaintFiles[0].reference_audio, null)

  const repaintRequest = submitted[1]
  assert.equal(repaintRequest.task_type, 'repaint')
  assert.equal(repaintRequest.lyrics, preservedLyrics)
  assert.equal(repaintRequest.repainting_start, 2)
  assert.equal(repaintRequest.repainting_end, 6)
  assert.equal(repaintRequest.repaint_mode, 'balanced')
  assert.equal(repaintRequest.repaint_strength, 0.6)
  assert.equal(repaintRequest.repaint_latent_crossfade_frames, 12)
  assert.equal(repaintRequest.repaint_wav_crossfade_sec, 0.2)
  assert.equal(repaintRequest.thinking, false)
  assert.equal(repaintRequest.use_cot_caption, false)
  assert.equal(repaintRequest.use_cot_language, false)
  assert.equal(repaintRequest.inference_steps, 8)
  assert.match(repaintRequest.src_audio_path, /moodtrack-repaint-/)
  assert.equal(Object.prototype.hasOwnProperty.call(repaintRequest, 'reference_audio_path'), false)

  const retryCreated = await post(baseUrl, '/ace-step/release_task', {
    task_type: 'text2music',
    prompt: 'Language validation retry test',
    lyrics: '',
    sample_mode: true,
    sample_query: 'force-language-retry',
    instrumental: false,
    vocal_language: 'zh',
    bpm: 92,
    key_scale: 'F minor',
    audio_duration: 10,
    emotion_context: { description: '平静中带着希望', duration: 10, moods: [] },
  })
  const retryFiles = await waitForTask(baseUrl, retryCreated.task_id)
  const retryRequests = sampleRequests.filter((item) => String(item.query).includes('force-language-retry'))
  assert.equal(retryRequests.length, 1)
  assert.match(retryFiles[0].lyrics, /\p{Script=Han}{4,}/u)
  assert.doesNotMatch(retryFiles[0].lyrics, /mixed language/i)
  assert.doesNotMatch(retryFiles[0].lyrics, /[\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}]/u)

  const instrumental = await post(baseUrl, '/ace-step/release_task', {
    task_type: 'text2music',
    prompt: 'Restrained felt piano with a clear and coherent melodic arc',
    lyrics: '[Instrumental - restrained felt piano motif]',
    sample_mode: false,
    sample_query: '',
    instrumental: true,
    vocal_language: 'unknown',
    bpm: 84,
    key_scale: 'D Major',
    audio_duration: 10,
    emotion_context: { description: '温柔而平静', duration: 10, moods: [] },
  })
  await waitForTask(baseUrl, instrumental.task_id)
  const instrumentalRequest = submitted[3]
  assert.equal(instrumentalRequest.task_type, 'text2music')
  assert.equal(instrumentalRequest.thinking, true)
  assert.equal(instrumentalRequest.use_cot_caption, false)
  assert.equal(instrumentalRequest.use_cot_language, false)
  assert.equal(instrumentalRequest.inference_steps, 8)
  assert.equal(instrumentalRequest.use_random_seed, true)
  assert.equal(instrumentalRequest.model, 'acestep-v15-turbo')
  assert.equal(Object.prototype.hasOwnProperty.call(instrumentalRequest, 'reference_audio_path'), false)
  assert.equal(submitted.every((request) => !Object.prototype.hasOwnProperty.call(request, 'reference_audio_path')), true)

  console.log('ACE local adapter integration test passed.')
} finally {
  await vite.close()
  localServer.close()
  await once(localServer, 'close')
  await rm(scratch, { recursive: true, force: true })
  delete process.env.ACESTEP_PROVIDER
  delete process.env.ACESTEP_LOCAL_API_URL
  delete process.env.ACESTEP_LOCAL_AUDIO_ROOT
}
