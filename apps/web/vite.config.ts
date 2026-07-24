import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        background_color: '#e8efe8',
        description: 'Multi-vehicle maintenance tracker',
        display: 'standalone',
        icons: [
          {
            sizes: '192x192',
            src: 'pwa-192.png',
            type: 'image/png',
          },
          {
            sizes: '512x512',
            src: 'pwa-512.png',
            type: 'image/png',
          },
          {
            purpose: 'maskable',
            sizes: '512x512',
            src: 'pwa-512-maskable.png',
            type: 'image/png',
          },
        ],
        name: 'Vehicles',
        orientation: 'any',
        short_name: 'Vehicles',
        start_url: '/',
        theme_color: '#1a2e24',
      },
      registerType: 'autoUpdate',
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3002',
    },
  },
})
