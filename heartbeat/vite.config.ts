import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cloudflare } from '@cloudflare/vite-plugin'
import { sites } from './build/sites-vite-plugin'
import { aceStepMiddleware } from './scripts/ace-step-middleware'
import { gvmgenMiddleware } from './scripts/gvmgen-middleware'

export default defineConfig({
  plugins: [
    aceStepMiddleware(),
    gvmgenMiddleware(),
    vue(),
    sites(),
    cloudflare({ viteEnvironment: { name: 'server' } }),
  ],
  server: {
    port: 5174,
    allowedHosts: ['.trycloudflare.com'],
    watch: {
      ignored: ['**/services/ACE-Step-1.5/**'],
    },
  },
})
