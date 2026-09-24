// Web app build (the only package with a build step, ADR-WEB-001). In development, Vite proxies
// /api to the API so the session cookie stays on the same origin.

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.DEMIURGO_WEB_API ?? 'http://127.0.0.1:8100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.DEMIURGO_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
