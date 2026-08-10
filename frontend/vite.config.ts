import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { aceStepMiddleware } from './scripts/ace-step-middleware'

export default defineConfig({
  plugins: [aceStepMiddleware(), vue()],
  server: {
    port: 5173,
    allowedHosts: ['.trycloudflare.com'],
    watch: {
      ignored: ['**/services/ACE-Step-1.5/**'],
    },
  },
})
