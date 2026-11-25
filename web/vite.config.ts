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
        theme_color: '#059669',
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
        // Precache the handwriting font too, so the notebook look works offline
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // The sheet-music engraver (Verovio, ~8 MB) is fetched the first time a
        // score is opened; keep it out of the precache every visitor downloads.
        globIgnores: ['**/verovio.worker-*.js'],
        // Navigations: vite-plugin-pwa registers a NavigationRoute that answers
        // them with the precached index.html (that is what lets the installed
        // app open offline); a new deploy replaces it through autoUpdate.
        // Public share pages and API URLs are excluded, so they always go to
        // the server, which answers share pages with real 404/410 statuses and
        // link-preview tags.
        navigateFallbackDenylist: [/^\/share\//, /^\/api\//],
        // Workbox tests a RegExp urlPattern against the full URL
        // (https://host/api/...), so the API rules match on url.pathname in
        // functions instead. The functions are serialised into sw.js: each one
        // must be self-contained (no outer variables). Only GET is handled.
        runtimeCaching: [
          {
            // Navigations the precached index.html doesn't answer (share
            // pages) — network first, cached copy only when offline
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'navigation', expiration: { maxEntries: 5, maxAgeSeconds: 24 * 60 * 60 } },
          },
          {
            // Song list — fresh while online (an edit is never followed by a
            // stale read), cached copy when offline or the network is slow
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === '/api/songs',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'songs-list',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 10, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Individual songs — chart/lyrics kept for offline Perform mode
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/api\/songs\/\d+$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'songs-detail',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Auth — never cache
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/auth/'),
            handler: 'NetworkOnly',
          },
          {
            // Audio — never cache
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /^\/api\/(tracks|sessions)\/\d+\/audio/.test(url.pathname),
            handler: 'NetworkOnly',
          },
          {
            // Public share links (data and audio) — never cache, so a revoked or
            // expired link stops working at once
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/share/'),
            handler: 'NetworkOnly',
          },
          {
            // Sheet-music files, admin data, job progress and the share-link
            // list — never cache
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin &&
              (/^\/api\/songs\/\d+\/score$/.test(url.pathname) ||
                url.pathname.startsWith('/api/admin/') ||
                url.pathname.startsWith('/api/jobs/') ||
                url.pathname === '/api/shares' ||
                url.pathname.startsWith('/api/shares/')),
            handler: 'NetworkOnly',
          },
          {
            // All other API — try network first, fall back to cache
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'api-general', expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
