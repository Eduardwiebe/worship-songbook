import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      strategies: 'generateSW',
      filename: 'sw.js',
      manifest: false,
      includeAssets: [
        'brand-icon.png',
        'brand-icon-180.png',
        'favicon.png',
        'favicon.svg',
        'apple-touch-icon.png',
        'icons/*.png',
        'install.html',
        'install/index.html',
        'join.html',
        'join/index.html',
        'manifest.webmanifest',
        'manifest.json',
        'version.json',
        'cajon-hit.mp3',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json,woff2,mp3}'],
        // Hash routes and `/?source=pwa` (iPad home screen) must open the
        // precached shell when the network is gone. API stays NetworkOnly;
        // song bytes live in IndexedDB so iOS Cache Storage keeps the shell.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
