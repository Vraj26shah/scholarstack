import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read VITE_* from the repo root .env (written by `pnpm env:sync`) as well as this folder.
  envDir: '.',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    env: { VITE_ALLOWED_EMAIL_DOMAIN: 'vitbhopal.ac.in' },
    setupFiles: ['src/test-setup.ts'],
  },
});
