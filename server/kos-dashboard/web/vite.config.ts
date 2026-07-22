import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Frontend for the KOS dashboard. Built output (dist/) is served statically
// by the sibling Hono/Bun backend (../src/index.ts) at the same origin, so
// no `base` override is needed. The dev-server proxy below only matters for
// `vite dev` (backend runs standalone on :7226 in that case).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7226',
    },
  },
});
