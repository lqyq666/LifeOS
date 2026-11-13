import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  build: {
    rollupOptions: {
      input: { main: 'index.html', companion: 'companion-preview.html' },
      output: {
        onlyExplicitManualChunks: false,
        manualChunks(id) {
          // Shared React/CommonJS helpers must not pull the lazy 3D scene
          // into the chat entry's static dependency graph.
          if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(id) || id.includes('commonjsHelpers.js') || id.includes('vite/preload-helper')) return 'react'
          if (/\/node_modules\/(?:three|@react-three)\//.test(id)) return 'three'
          if (/\/node_modules\/(?:framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion'
        },
      },
    },
  },
})
