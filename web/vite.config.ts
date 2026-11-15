import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'
import { PRODUCT_NAME } from './src/config.ts'

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8010'

export default defineConfig(async ({ command }) => {
  const plugins: PluginOption[] = [
    react(),
    tailwindcss(),
    { name: 'product-name', transformIndexHtml: (html) => html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME) },
  ]

  // Dev-only in-memory backend for looking at screens without the real API.
  // Opt-in with DING_MOCK=1 and only ever loaded by `vite` (serve), never by `vite build`.
  const useMock = command === 'serve' && process.env.DING_MOCK === '1'
  if (useMock) {
    const { mockApi } = await import('./mock/mockApi.ts')
    plugins.push(mockApi())
  }

  return {
    plugins,
    // A second dev server (e.g. for verification) can keep its own pre-bundle cache.
    cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: useMock
        ? undefined
        : {
            '/api': { target: API_TARGET, changeOrigin: false },
            '/media': { target: API_TARGET, changeOrigin: false },
          },
    },
  }
})
