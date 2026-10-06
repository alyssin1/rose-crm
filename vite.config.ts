import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest', // service worker prÃ³prio (src/sw.ts) para Web Push
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.png', 'apple-touch-icon.png'],
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] },
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Rose',
        short_name: 'Rose',
        description: 'Tarefas, calendÃ¡rio e lembretes.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#1b1b20',
        theme_color: '#1b1b20',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // o Replit serve o preview por um domÃ­nio *.replit.dev: libera o host
  server: { port: 5173, host: true, allowedHosts: true },
  preview: { port: 5173, host: true, allowedHosts: true },
})
