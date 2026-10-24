import { defineConfig } from 'vite';

// Builds the command line (`dist/cli.js`, the `bin` entry) and the library entries
// (`dist/index.js` and the subpath entries `run`, `net-cli`, `testing`) as plain JavaScript for
// Node 22.19 or later. Code the entries share is split into `dist/chunks`. Dependencies and
// Node's own modules stay outside the bundle; the package's one runtime dependency is installed
// beside it. The type declarations are written afterwards by scripts/build-types.mjs.
export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        cli: 'src/cli/bin.ts',
        index: 'src/index.ts',
        run: 'src/cli/run.ts',
        'net-cli': 'src/net/cli.ts',
        testing: 'src/net/testing/index.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
