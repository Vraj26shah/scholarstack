import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** One id per build: written into the code and into /version.json, so open tabs can tell a new release is live. */
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 12) ?? Date.now().toString(36);
const versionFile = (): Plugin => ({
  name: 'ss-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
});

/**
 * Readable stack traces in Sentry. Only when SENTRY_AUTH_TOKEN is set (the production deploy):
 * the build writes source maps, uploads them to Sentry tagged with this release, then deletes
 * them, so they are never published with the site. Local and demo builds have no maps at all.
 */
// Trimmed: a token pasted into GitHub with a trailing space or line break is otherwise refused (401).
const sentryToken = process.env.SENTRY_AUTH_TOKEN?.trim() || undefined;
const uploadSourceMaps = !!sentryToken;
const sourceMaps = (): Plugin[] =>
  uploadSourceMaps
    ? sentryVitePlugin({
        org: process.env.SENTRY_ORG ?? 'scholars-stack',
        project: process.env.SENTRY_PROJECT ?? 'scholarstack-web',
        authToken: sentryToken,
        // The same release the site tags its events with (analytics.ts).
        release: { name: process.env.VITE_APP_RELEASE },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      })
    : [];

/**
 * File names without "sentry" in them: common ad-blocker lists block any script whose name
 * mentions it, and then the site can report nothing at all for that visitor.
 */
const neutral = (name: string) => name.replace(/sentry/gi, 'mon');

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile(), ...sourceMaps()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Read VITE_* from the repo root .env (written by `pnpm env:sync`) as well as this folder.
  envDir: '.',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    // "hidden": maps are written for the upload but no file points at them.
    sourcemap: uploadSourceMaps ? 'hidden' : false,
    target: 'es2022',
    rollupOptions: {
      output: {
        chunkFileNames: (chunk) => `assets/${neutral(chunk.name)}-[hash].js`,
        // Libraries change rarely: keep them in their own long-cached files, so a site update
        // only re-downloads the app code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Only the lazily loaded monitoring code imports Sentry, so this chunk is never part of
          // the first page load (the catch-all "vendor" chunk is preloaded on every page).
          if (id.includes('@sentry') || id.includes('@sentry-internal')) return 'vendor-monitor';
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
