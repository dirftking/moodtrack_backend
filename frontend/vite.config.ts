import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { aceStepMiddleware } from './scripts/ace-step-middleware'
import { aceStepLocalMiddleware } from './scripts/ace-step-local-middleware'
import { gvmgenMiddleware } from './scripts/gvmgen-middleware'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const aceProvider = String(env.ACESTEP_PROVIDER || 'local').trim().toLowerCase()
  const acePlugin = aceProvider === 'cloud'
    ? aceStepMiddleware({
        apiUrl: env.ACESTEP_API_URL,
        apiKey: env.ACESTEP_API_KEY,
        model: env.ACESTEP_MODEL,
      })
    : aceStepLocalMiddleware({
        apiUrl: env.ACESTEP_LOCAL_API_URL,
        model: env.ACESTEP_LOCAL_MODEL,
        referenceRoot: env.ACESTEP_REFERENCE_ROOT,
        audioRoot: env.ACESTEP_LOCAL_AUDIO_ROOT,
      })

  return {
    plugins: [
      acePlugin,
      gvmgenMiddleware(),
      vue(),
    ],
    server: {
      port: 5173,
      allowedHosts: ['.trycloudflare.com'],
      watch: {
        ignored: ['**/services/ACE-Step-1.5/**'],
      },
      fs: {
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem,key,p12,pfx,cer,der}',
          '.npmrc',
          '.yarnrc.yml',
          '**/.git/**',
          'emotion-reference-library/**',
          '**/emotion-reference-library/**',
        ],
      },
    },
  }
})
