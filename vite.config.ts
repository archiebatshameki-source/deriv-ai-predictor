// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 Shogo Technologies, Inc.
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  // Absolute base, not relative. With a relative base ('./'), a page served at a nested
  // route such as /oauth/callback resolves its asset URLs to /oauth/assets/... which the
  // SPA fallback answers with index.html — a module script served as text/html is refused,
  // so React never boots and the page renders blank.
  //
  // VITE_BASE_PATH overrides it for subpath hosting (GitHub Pages project sites serve at
  // /<repo>/, where a '/' base would request assets from the domain root and 404).
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 3000,
    host: '0.0.0.0',
    cors: true,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_SERVER_PORT}`,
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ['**/.shogo/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    react(),
  ],
  build: {
    target: 'esnext',
    minify: false,
  },
})
