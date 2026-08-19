import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { once } from 'node:events'
import { createServer as createViteServer } from 'vite'

const fakeKey = 'test-only-cloud-key'
const completionRequests = []
const tinyAudioBytes = Buffer.alloc(44 + 32)
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
const tinyAudio = tinyAudioBytes.toString('base64')

function json(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const cloudServer = createHttpServer(async (request, response) => {
  if (request.url === '/health' && request.method === 'GET') {
    assert.equal(request.headers.authorization, `Bearer ${fakeKey}`)
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('health check')
    return
  }

  if (request.url === '/v1/models' && request.method === 'GET') {
    assert.equal(request.headers.authorization, `Bearer ${fakeKey}`)
    json(response, 200, { data: [{ id: 'acemusic/acestep-v15-turbo' }] })
    return
  }

  if (request.url === '/v1/chat/completions' && request.method === 'POST') {
    assert.equal(request.headers.authorization, `Bearer ${fakeKey}`)
    const body = await readBody(request)
    completionRequests.push(body)
    const serializedMessages = JSON.stringify(body.messages)
    const invalidAudio = serializedMessages.includes('RETURN_INVALID_AUDIO_FOR_TEST')
    const returnedLyrics = body.task_type === 'repaint'
      ? 'This cloud response must not replace the preserved source lyric'
      : 'A brand new test lyric'
    json(response, 200, {
      id: `chatcmpl-test-${completionRequests.length}`,
      model: 'acemusic/acestep-v15-turbo',
      choices: [{
        finish_reason: 'stop',
        message: {
          content: [
            '## Metadata',
            '**Caption:** Test cloud composition',
            '**BPM:** 120',
            '**Duration:** 10s',
            '**Key:** C Major',
            '',
            '## Lyrics',
            '[Verse 1]',
            returnedLyrics,
          ].join('\n'),
          audio: [{
            type: 'audio_url',
            audio_url: {
              url: `data:audio/wav;base64,${invalidAudio ? Buffer.from('not a wav').toString('base64') : tinyAudio}`,
            },
          }],
        },
      }],
    })
    return
  }

  json(response, 404, { detail: 'not found' })
})

cloudServer.listen(0, '127.0.0.1')
await once(cloudServer, 'listening')
const cloudAddress = cloudServer.address()
assert(cloudAddress && typeof cloudAddress === 'object')

process.env.ACESTEP_API_URL = `http://127.0.0.1:${cloudAddress.port}`
process.env.ACESTEP_API_KEY = fakeKey
process.env.ACESTEP_MODEL = 'acemusic/acestep-v15-turbo'
process.env.ACESTEP_PROVIDER = 'cloud'

const vite = await createViteServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'silent',
})

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  assert.equal(response.ok, true, payload.error || `HTTP ${response.status}`)
  assert.equal(payload.code, 200)
  return payload.data
}

async function waitForTask(baseUrl, taskId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const tasks = await post(baseUrl, '/ace-step/query_result', { task_id_list: [taskId] })
    if (tasks[0]?.status === 1) return JSON.parse(tasks[0].result)
    if (tasks[0]?.status === 2) throw new Error(tasks[0].error)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Mock cloud task timed out')
}

try {
  await vite.listen()
  const viteAddress = vite.httpServer?.address()
  assert(viteAddress && typeof viteAddress === 'object')
  const baseUrl = `http://127.0.0.1:${viteAddress.port}`

  for (const privatePath of [
    '/emotion-reference-library/manifest.json',
    '/emotion-reference-library/audio/joy/reference.wav',
  ]) {
    const privateResponse = await fetch(`${baseUrl}${privatePath}`)
    assert.equal(privateResponse.status, 404, `${privatePath} must remain server-only`)
  }

  const healthResponse = await fetch(`${baseUrl}/ace-step/health`)
  assert.equal(healthResponse.status, 200)
  const health = await healthResponse.json()
  assert.equal(health.data.status, 'ok')
  assert.equal(health.data.text_agent, 'moodtrack-text-agent-v1')
  assert.equal(health.data.emotion_reference_categories, 0)
  assert.equal(health.data.reference_audio_enabled, false)

  const compoundEmotion = await post(baseUrl, '/ace-step/emotions/classify', {
    title: 'After the rain',
    scene: '毕业后的清晨',
    style: 'warm chamber pop',
    description: '失落但充满希望',
    duration: 60,
    moods: [
      { label: '失落', time: 0, intensity: 58 },
      { label: '希望', time: 32, intensity: 82 },
    ],
  })
  assert.equal(compoundEmotion.primary.id, 'hope')
  assert.equal(compoundEmotion.secondary.id, 'sadness')
  assert.equal(compoundEmotion.referenceEmotionId, null)
  assert.equal(compoundEmotion.reference, null)

  const rainyLoneliness = await post(baseUrl, '/ace-step/emotions/classify', {
    description: '雨天的孤独感',
    duration: 30,
    moods: [],
  })
  assert.equal(rainyLoneliness.primary.id, 'sadness')

  const negatedSadness = await post(baseUrl, '/ace-step/emotions/classify', {
    description: '很安静但不是悲伤',
    duration: 30,
    moods: [],
  })
  assert.equal(negatedSadness.primary.id, 'calm')

  const presetMappings = new Map([
    ['放空', 'calm'], ['沉浸', 'calm'], ['陶醉', 'joy'], ['安宁', 'calm'],
    ['平静', 'calm'], ['怀念', 'nostalgia'], ['释放', 'healing'], ['释然', 'healing'],
    ['蓄势', 'tension'], ['紧张', 'tension'], ['爆发', 'anger'], ['胜利', 'triumph'],
    ['神秘', 'mystery'], ['期待', 'hope'], ['震撼', 'triumph'], ['自信', 'triumph'],
  ])
  for (const [description, expected] of presetMappings) {
    const classified = await post(baseUrl, '/ace-step/emotions/classify', {
      description,
      duration: 30,
      moods: [],
    })
    assert.equal(classified.primary.id, expected, `Unexpected mapping for ${description}`)
  }

  const unknownEmotion = await post(baseUrl, '/ace-step/emotions/classify', {
    description: 'qwerty-zxcv-12345',
    duration: 30,
    moods: [],
  })
  assert.equal(unknownEmotion.fallback, true)
  assert.equal(unknownEmotion.reference, null)

  const clientModule = await vite.ssrLoadModule('/src/aceStepClient.ts')
  const fallbackPromptOptions = {
    title: 'Unclassified feeling',
    scene: 'Abstract scene',
    style: 'Minimal electronic',
    instruments: ['piano'],
    productionPrompt: 'Detailed and spacious production.',
    instrumentalStructure: '[Instrumental]',
    presetId: 'test',
    musicKey: 'C Major',
    bpm: 90,
    duration: 30,
    moods: [],
    emotionDescription: 'qwerty-zxcv-12345',
    instrumental: false,
    vocalStyle: 'soft lead vocal',
    vocalLanguage: 'en',
    lyrics: '[Verse 1]\nOriginal test lyric',
    variation: 1,
  }
  const fallbackVariant = { name: 'Test variant', direction: 'Use a new melody.', section: '[Instrumental]' }
  const fallbackPrompt = clientModule.buildPrompt(fallbackPromptOptions, fallbackVariant, unknownEmotion)
  const fallbackLyricQuery = clientModule.buildLyricQuery(fallbackPromptOptions, fallbackVariant, 1, unknownEmotion)
  assert.match(fallbackPrompt, /User emotion description: qwerty-zxcv-12345/)
  assert.doesNotMatch(fallbackPrompt, /Standard emotion:/)
  assert.doesNotMatch(fallbackPrompt, /\bcalm\b|meditative stillness/i)
  assert.match(fallbackLyricQuery, /preserve the original wording without adding a default emotion/i)
  assert.doesNotMatch(fallbackLyricQuery, /平静|\bcalm\b/i)

  const freeformPrompt = `FREEFORM-START ${'custom texture '.repeat(18)} FREEFORM-END`
  const freeformOptions = {
    ...fallbackPromptOptions,
    title: 'FREEFORM-TITLE-MARKER',
    scene: 'FREEFORM-SCENE-MARKER',
    style: freeformPrompt,
    productionPrompt: freeformPrompt,
    presetId: 'freeform',
    instrumental: true,
    vocalStyle: '',
    emotionDescription: '',
    moods: [
      { label: '开始', time: 0, intensity: 45 },
      { label: '结束', time: 30, intensity: 50 },
    ],
  }
  const freeformVariant = {
    name: '自由指令',
    direction: 'Follow the user-provided prompt as the primary creative specification.',
    section: '',
  }
  const freeformBuiltPrompt = clientModule.buildPrompt(freeformOptions, freeformVariant, compoundEmotion)
  assert.match(freeformBuiltPrompt, /FREEFORM-START/)
  assert.match(freeformBuiltPrompt, /FREEFORM-END/)
  assert.doesNotMatch(freeformBuiltPrompt, /FREEFORM-TITLE-MARKER/)
  assert.doesNotMatch(freeformBuiltPrompt, /FREEFORM-SCENE-MARKER/)
  assert.doesNotMatch(freeformBuiltPrompt, /Prompt priority|Standard emotion|Overall emotion|User emotion|Emotional arc/i)
  assert.doesNotMatch(freeformBuiltPrompt, /Rhodes|night-driving|descending progression|tonic pedal/i)

  const controlledPresetPrompt = clientModule.buildPrompt({
    ...fallbackPromptOptions,
    instrumental: true,
    productionPrompt: 'Instrumental restrained ambient piano. No guitars, brass or vocals.',
    emotionDescription: '安静、克制，逐渐回到平和',
    moods: [{ label: '陶醉', time: 20, intensity: 82 }],
  }, fallbackVariant, compoundEmotion)
  assert.match(controlledPresetPrompt, /Overall emotion: Hope\./)
  assert.match(controlledPresetPrompt, /20s 陶醉 at 82% intensity/)
  assert.doesNotMatch(controlledPresetPrompt, /Standard emotion|secondary nuance|\/ Joy|playful warmth/i)

  const rejectedReferenceMetadata = clientModule.resolveGeneratedEmotionMetadata({
    emotion_analysis: compoundEmotion,
    reference_audio: null,
  }, compoundEmotion)
  assert.equal(rejectedReferenceMetadata.reference, null)
  assert.equal(rejectedReferenceMetadata.emotionAnalysis.reference, null)

  const knownMoodWithUnknownDescription = await post(baseUrl, '/ace-step/emotions/classify', {
    description: '完全无法归类的随机描述 qwerty',
    duration: 30,
    moods: [{ label: '开心', time: 0, intensity: 20 }],
  })
  assert.equal(knownMoodWithUnknownDescription.primary.id, 'joy')
  assert.equal(knownMoodWithUnknownDescription.reference, null)

  const boundaryOnly = await post(baseUrl, '/ace-step/emotions/classify', {
    description: 'dangerous adventure',
    duration: 30,
    moods: [],
  })
  assert.equal(boundaryOnly.fallback, true)
  assert.equal(boundaryOnly.reference, null)

  for (const description of [
    'hopeless night',
    'unhappy',
    'not very happy',
    '并没有感到开心',
    '不开心',
  ]) {
    const classified = await post(baseUrl, '/ace-step/emotions/classify', {
      description,
      duration: 30,
      moods: [],
    })
    assert.equal(classified.primary.id, 'sadness', `Unexpected negation mapping for ${description}`)
    assert.equal(classified.reference, null)
  }

  const created = await post(baseUrl, '/ace-step/release_task', {
    task_type: 'text2music',
    prompt: 'Cloud adapter test song',
    lyrics: '',
    sample_mode: true,
    sample_query: 'Write a new English test song',
    instrumental: false,
    vocal_language: 'en',
    bpm: 120,
    key_scale: 'C Major',
    audio_duration: 10,
    reference_emotion_id: 'hope',
    emotion_context: {
      title: 'After the rain',
      scene: '毕业后的清晨',
      style: 'warm chamber pop',
      description: '失落但充满希望',
      duration: 10,
      moods: [
        { label: '失落', time: 0, intensity: 58 },
        { label: '希望', time: 6, intensity: 82 },
      ],
    },
  })
  const generatedFiles = await waitForTask(baseUrl, created.task_id)
  assert.equal(generatedFiles.length, 1)
  assert.match(generatedFiles[0].lyrics, /brand new test lyric/i)
  assert.equal(generatedFiles[0].emotion_analysis.primary.id, 'hope')
  assert.equal(generatedFiles[0].reference_audio, null)

  const audioResponse = await fetch(`${baseUrl}/ace-step${generatedFiles[0].file}`)
  assert.equal(audioResponse.status, 200)
  assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), tinyAudioBytes)

  const preservedRepaintLyrics = generatedFiles[0].lyrics
  const repaint = await post(baseUrl, '/ace-step/release_task', {
    task_type: 'repaint',
    prompt: 'Strengthen the selected range while preserving the lead vocal',
    lyrics: preservedRepaintLyrics,
    instrumental: false,
    vocal_language: 'en',
    source_file: generatedFiles[0].file,
    bpm: 120,
    key_scale: 'C Major',
    audio_duration: 10,
    repainting_start: 2,
    repainting_end: 6,
    repaint_strength: 0.6,
    reference_emotion_id: 'hope',
  })
  const repaintFiles = await waitForTask(baseUrl, repaint.task_id)
  assert.equal(repaintFiles[0].lyrics, preservedRepaintLyrics)
  assert.doesNotMatch(repaintFiles[0].lyrics, /must not replace/i)
  assert.equal(repaintFiles[0].reference_audio, null)

  assert.equal(completionRequests.length, 2)
  assert.equal(completionRequests[0].sample_mode, true)
  assert.equal(completionRequests[0].messages[0].content, 'Write a new English test song')
  assert.equal(completionRequests[1].task_type, 'repaint')
  assert.equal(completionRequests[1].lyrics, preservedRepaintLyrics)
  assert.equal(completionRequests[1].audio_config.instrumental, false)
  assert.equal(completionRequests[1].audio_config.vocal_language, 'en')
  assert.equal(Array.isArray(completionRequests[1].messages[0].content), true)
  assert.equal(completionRequests[1].messages[0].content[1].type, 'input_audio')
  assert.equal(completionRequests[1].messages[0].content[1].input_audio.format, 'wav')
  assert.deepEqual(Buffer.from(completionRequests[1].messages[0].content[1].input_audio.data, 'base64'), tinyAudioBytes)
  assert.equal(completionRequests[1].messages[0].content.length, 2)

  const requestCountBeforeNoReferenceTask = completionRequests.length
  const noReferenceTask = await post(baseUrl, '/ace-step/release_task', {
    task_type: 'text2music',
    prompt: 'NO_REFERENCE_AUDIO_TEST',
    lyrics: '[Instrumental]',
    sample_mode: false,
    instrumental: true,
    vocal_language: 'unknown',
    bpm: 90,
    key_scale: 'C Major',
    audio_duration: 10,
    reference_emotion_id: 'hope',
    emotion_context: {
      description: '充满希望',
      duration: 10,
      moods: [],
    },
  })
  const noReferenceFiles = await waitForTask(baseUrl, noReferenceTask.task_id)
  assert.equal(noReferenceFiles[0].reference_audio, null)
  assert.equal(completionRequests.length, requestCountBeforeNoReferenceTask + 1)
  assert.equal(completionRequests[requestCountBeforeNoReferenceTask].messages[0].content, 'NO_REFERENCE_AUDIO_TEST')

  const invalidAudioTask = await post(baseUrl, '/ace-step/release_task', {
    task_type: 'text2music',
    prompt: 'RETURN_INVALID_AUDIO_FOR_TEST',
    lyrics: '[Instrumental]',
    sample_mode: false,
    instrumental: true,
    vocal_language: 'unknown',
    bpm: 90,
    key_scale: 'C Major',
    audio_duration: 10,
    emotion_context: {
      description: 'qwerty-zxcv-12345',
      duration: 10,
      moods: [],
    },
  })
  await assert.rejects(
    waitForTask(baseUrl, invalidAudioTask.task_id),
    /音频格式无效或与 MIME 类型不一致/,
  )

  console.log('ACE cloud adapter integration test passed.')
} finally {
  await vite.close()
  cloudServer.close()
  await once(cloudServer, 'close')
  delete process.env.ACESTEP_API_URL
  delete process.env.ACESTEP_API_KEY
  delete process.env.ACESTEP_MODEL
  delete process.env.ACESTEP_PROVIDER
}
