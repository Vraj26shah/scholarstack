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
    rollupOptions: {
      output: {
        // Libraries change rarely: keep them in their own long-cached files, so a site update
        // only re-downloads the app code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'vendor-auth';
          if (
            id.includes('react-router') ||
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('scheduler')
          )
            return 'vendor-react';
          if (id.includes('@tanstack') || id.includes('zustand')) return 'vendor-data';
          if (id.includes('@radix-ui')) return 'vendor-ui';
          if (id.includes('/zod/')) return 'vendor-zod';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    env: { VITE_ALLOWED_EMAIL_DOMAIN: 'vitbhopal.ac.in' },
    setupFiles: ['src/test-setup.ts'],
  },
});
