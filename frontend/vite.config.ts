import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }
const apiTarget = process.env.VITE_API_PROXY || 'http://127.0.0.1:8788'

// Run `vite --config frontend/vite.config.ts` from the project root. We set
// `root` to this dir so Vite finds frontend/index.html, and `outDir` to
// ../dist so the backend web tier can serve `${cwd}/dist`.
export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      // Uploaded images served by the API too — keep /uploads paths working
      // in dev (vite at :5174) without running the web tier (:4174).
      '/uploads': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
