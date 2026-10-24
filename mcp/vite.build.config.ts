import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Builds the server (`dist/server.js`, the `bin` entry) as plain JavaScript for Node 22.19 or
// later.
//
// Where the checking code of @queryrev/ai-readiness comes from depends on package.json:
//
// - In the published package it is a runtime dependency (`dependencies`), installed beside this
//   package from npm, so `dist` imports it by name and holds none of its code.
// - In the repository it is a workspace package whose entry points are source files that Node
//   cannot run, so it is a development dependency and its code is bundled into `dist`.
//
// The protocol SDK, zod and undici are runtime dependencies in both cases and stay outside.
const manifest = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const core = '@queryrev/ai-readiness';
const coreIsInstalled = Object.hasOwn(manifest.dependencies ?? {}, core);

export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: { server: 'src/bin.ts' },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
  ssr: { noExternal: coreIsInstalled ? [] : [core] },
});
