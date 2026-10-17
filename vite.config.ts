import { defineConfig } from 'vite';

// 개발 중에는 /api, /ws, /social 을 로컬 Cloudflare 서버(wrangler dev :8787)로 넘긴다
export default defineConfig({
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
      '/social': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
