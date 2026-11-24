import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // allowedHosts: true — the sandboxed live preview proxies the dev server through an e2b.app host,
  // which the default allowlist would block. Locally this only relaxes dev-server host checking.
  server: { port: 5273, host: '127.0.0.1', open: false, allowedHosts: true },
  preview: { port: 4273, host: '127.0.0.1', open: false, allowedHosts: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
});
