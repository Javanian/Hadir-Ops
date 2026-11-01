import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE_URL || '/api'
  const proxyTarget =
    env.VITE_API_PROXY_TARGET ||
    (apiBase.startsWith('http') ? apiBase : 'http://localhost:8000')

  return {
    plugins: [react(), tailwindcss()],
    build: {
      // Small font subsets would otherwise be inlined as data: URIs, which the
      // Content-Security-Policy (font-src 'self') refuses.
      assetsInlineLimit: (file: string) => (file.endsWith('.woff2') || file.endsWith('.woff') ? false : undefined),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
