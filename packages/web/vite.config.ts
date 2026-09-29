// Web app build (the only package with a build step, ADR-WEB-001). In development, Vite proxies
// /api to the API so the session cookie stays on the same origin.

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.DEMIURGO_WEB_API ?? 'http://127.0.0.1:8100';

// Read by `vite build --watch` at runtime (build.watch.chokidar), though its type doesn't declare it.
const polling = { chokidar: { usePolling: true, interval: 500 } };

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
  build: {
    // `vite build --watch` in the web-build container: with the repo mounted from macOS (Colima,
    // virtiofs) native file events don't reach the per-file watchers, so it never rebuilt. Polling
    // (DEMIURGO_WATCH_POLLING=1, set in compose.yaml) does. Vite builds rolldown's watcher from
    // `chokidar` (usePolling, interval) and overrides `watcher`, so it goes there.
    ...(process.env.DEMIURGO_WATCH_POLLING === '1' ? { watch: { buildDelay: 0, ...polling } } : {}),
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // The libraries change less than the app: they go in their own chunks, cached apart.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'markdown', test: /node_modules[\\/].*(markdown|remark|micromark|mdast|unified|unist|hast|vfile)/ },
            { name: 'react', test: /node_modules[\\/].*(react|react-dom|scheduler)[\\/]/ },
            { name: 'radix', test: /node_modules[\\/].*@radix-ui[\\/]/ },
            { name: 'tanstack', test: /node_modules[\\/].*@tanstack[\\/]/ },
          ],
        },
      },
    },
  },
});
