// Emits the type declarations of the package into dist/ and makes their relative imports
// resolvable for every consumer: TypeScript's `nodenext` mode wants the file extension on a
// relative import, which the source does not write. Run after `vite build`, which empties dist/.
//
//   node scripts/build-types.mjs

/* global process, console */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], {
  cwd: root,
  stdio: 'inherit',
});
if (run.status !== 0) process.exit(run.status ?? 1);

async function declarationFiles(folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await declarationFiles(path)));
    else if (entry.name.endsWith('.d.ts')) found.push(path);
  }
  return found;
}

// `from './x'`, `export * from './x'` and `import('./x')`: a file `x.d.ts` becomes `./x.js`, a
// folder with an `index.d.ts` becomes `./x/index.js`.
const RELATIVE = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g;
let rewritten = 0;
for (const file of await declarationFiles(dist)) {
  const text = await readFile(file, 'utf8');
  const next = text.replace(RELATIVE, (whole, lead, quote, specifier) => {
    const target = resolve(dirname(file), specifier);
    if (existsSync(`${target}.d.ts`)) return `${lead}${quote}${specifier}.js${quote}`;
    if (existsSync(join(target, 'index.d.ts')))
      return `${lead}${quote}${specifier}/index.js${quote}`;
    throw new Error(`${file}: cannot resolve ${specifier}`);
  });
  if (next !== text) {
    await writeFile(file, next);
    rewritten += 1;
  }
}
console.log(`Type declarations written to dist/ (${rewritten} files had their imports completed).`);
