// Refuses a publish of a package.json that is not the published one: the entry points must be
// the built files in dist/. The repository's package.json points at the source for the other
// packages that live beside it; publishing from that folder would ship a package that cannot be
// installed. Run by `prepublishOnly` and by the release workflow.
//
//   node scripts/check-publishable.mjs [folder-with-package.json]

/* global process, console */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));

const main = manifest.main;
const entry = manifest.exports?.['.'];
const exportedDefault = typeof entry === 'string' ? entry : entry?.default;

const problems = [];
if (manifest.private === true) problems.push('"private" is true');
if (typeof main !== 'string' || !main.startsWith('./dist/')) {
  problems.push(`"main" is ${JSON.stringify(main)}, not a file in ./dist/`);
}
if (typeof exportedDefault !== 'string' || !exportedDefault.startsWith('./dist/')) {
  problems.push(
    `exports["."].default is ${JSON.stringify(exportedDefault)}, not a file in ./dist/`,
  );
}
if (problems.length > 0) {
  console.error(`Refusing to publish ${manifest.name}: ${problems.join('; ')}.`);
  console.error('Publish from the tree made by scripts/ai-readiness-export.mjs, not from here.');
  process.exit(1);
}
