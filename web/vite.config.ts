import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'JamJar',
        short_name: 'JamJar',
        description: 'Jam session catalog — charts, lyrics, and setlists',
        theme_color: '#6366f1',
        background_color: '#030712',
        display: 'standalone',
        start_url: '/songs',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Song list — show cached, refresh in background
            urlPattern: /^\/api\/songs(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'songs-list', expiration: { maxEntries: 10, maxAgeSeconds: 7 * 24 * 60 * 60 } },
          },
          {
            // Individual songs — cache chart/lyrics for offline perform mode
            urlPattern: /^\/api\/songs\/\d+$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'songs-detail', expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 } },
          },
          {
            // Auth — never cache
            urlPattern: /^\/api\/auth\//,
            handler: 'NetworkOnly',
          },
          {
            // Audio — never cache
            urlPattern: /^\/api\/(tracks|sessions)\/\d+\/audio/,
            handler: 'NetworkOnly',
          },
          {
            // All other API — try network first, fall back to cache
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-general', expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 } },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
