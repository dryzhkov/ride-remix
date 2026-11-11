import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pwaBuild } from './src/web/pwa/build';

export default defineConfig({
  plugins: [react(), pwaBuild()],
  build: { outDir: 'dist/web' },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/healthz': 'http://127.0.0.1:3000',
    },
  },
});
