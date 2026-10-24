// Refuses a publish of a package.json that is not the published one: the entry points must be
// the built files in dist/. The repository's package.json points at the source for the other
// packages that live beside it; publishing from that folder would ship a package that cannot be
// installed. Run by `prepublishOnly` and by the release workflow.
//
//   node scripts/check-publishable.mjs [folder-with-package.json] [--bin-only]
//
// `--bin-only` is for a package that is a program and not a library (the MCP server, which is
// exported with a copy of this script): it has no `main` and no `exports`, and what it must have
// is a `bin`. For every package, each `bin` file must be in ./dist/.

/* global process, console */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const binOnly = args.includes('--bin-only');
const folder = resolve(
  args.find((arg) => !arg.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));

const main = manifest.main;
const entry = manifest.exports?.['.'];
const exportedDefault = typeof entry === 'string' ? entry : entry?.default;

const problems = [];
if (manifest.private === true) problems.push('"private" is true');
if (!binOnly) {
  if (typeof main !== 'string' || !main.startsWith('./dist/')) {
    problems.push(`"main" is ${JSON.stringify(main)}, not a file in ./dist/`);
  }
  if (typeof exportedDefault !== 'string' || !exportedDefault.startsWith('./dist/')) {
    problems.push(
      `exports["."].default is ${JSON.stringify(exportedDefault)}, not a file in ./dist/`,
    );
  }
}
const bin = typeof manifest.bin === 'string' ? { [manifest.name]: manifest.bin } : manifest.bin;
if (binOnly && (bin === undefined || Object.keys(bin).length === 0)) {
  problems.push('"bin" is missing');
}
for (const [name, file] of Object.entries(bin ?? {})) {
  // Written as `dist/cli.js`: npm 11 removes a bin that starts with `./`.
  if (typeof file !== 'string' || !file.startsWith('dist/')) {
    problems.push(
      `bin "${name}" is ${JSON.stringify(file)}, not a file in dist/ (written dist/...)`,
    );
  }
}
if (problems.length > 0) {
  console.error(`Refusing to publish ${manifest.name}: ${problems.join('; ')}.`);
  console.error('Publish from the tree made by scripts/ai-readiness-export.mjs, not from here.');
  process.exit(1);
}
