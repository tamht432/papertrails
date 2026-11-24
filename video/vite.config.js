import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  publicDir: false,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
