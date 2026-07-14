import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Static SPA build (ADR-0003). `base: './'` + hash routing keep the bundle
 * host-agnostic: it works from `vite dev`, a file server, or any static host
 * subpath — no localhost-only assumptions (spec 002 Non-Goals).
 *
 * Workspace packages are aliased to their TypeScript sources so the demo needs
 * no package build step, mirroring how the Jest configs resolve them.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@smart-sneaker\/design-system$/,
        replacement: resolve(__dirname, '../../packages/design-system/src/index.ts'),
      },
      {
        find: /^@smart-sneaker\/data-contracts$/,
        replacement: resolve(__dirname, '../../packages/data-contracts/src/index.ts'),
      },
      {
        find: /^@smart-sneaker\/insights-engine$/,
        replacement: resolve(__dirname, '../../packages/insights-engine/src/index.ts'),
      },
    ],
  },
});
