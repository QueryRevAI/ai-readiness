import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { CRAWLERS, crawlersCoveredLine } from './crawlers';

// The package is published on its own, so three things are checked here: it imports nothing
// private (an import rule, relative paths that stay inside, no workspace dependency), the files
// a publish would carry are the allowed ones, and no file of the folder carries internal text.

const root = fileURLToPath(new URL('..', import.meta.url));
const SLOW = 120_000;
const ownManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  private?: boolean;
  scripts?: Record<string, string>;
};

// Built from parts so this file does not contain what it looks for.
const FORBIDDEN: [string, RegExp][] = [
  ['a model provider name', new RegExp(['anthro', 'pic'].join(''), 'i')],
  ['a model name', new RegExp(['clau', 'de'].join(''), 'i')],
  ['an internal role', new RegExp(['found', 'er'].join(''), 'i')],
  ['an internal path', new RegExp(['docs', '/'].join(''))],
  ['a specification reference', /\bspec(?:ification)?\s+\d/i],
  ['an environment variable read', new RegExp(['process', '\\.env'].join(''))],
  [
    'a build-status word',
    new RegExp(
      `\\b(?:${[
        ['in ', 'development'],
        ['plan', 'ned'],
        ['coming ', 'soon'],
        ['be', 'ta'],
        ['mv', 'p'],
        ['early ', 'access'],
        ['work in ', 'progress'],
        ['under ', 'construction'],
      ]
        .map((parts) => parts.join(''))
        .join('|')})\\b`,
      'i',
    ),
  ],
  [
    'a claim about a client that is not shipped',
    new RegExp(['works with any M', 'CP client'].join(''), 'i'),
  ],
  [
    'an internal host',
    new RegExp(['rail', 'way|ver', 'cel|ing', 'est|ne', 'on\\.tech|sen', 'try'].join(''), 'i'),
  ],
];

// Added for the built files: a path of the machine that built them.
const FORBIDDEN_IN_BUILT: [string, RegExp][] = [
  ...FORBIDDEN,
  ['a home folder path', new RegExp(['/ho', 'me/'].join(''))],
  ['a user folder path', new RegExp(['/Us', 'ers/'].join(''))],
  ['a drive path', new RegExp(['[A-Za-z]', ':\\\\'].join(''))],
];

function filesUnder(folder: string, includeBuilt = false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(folder)) {
    if (name === 'node_modules' || name === '.turbo' || name === 'coverage') continue;
    if (name === 'dist' && !includeBuilt) continue;
    const path = join(folder, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, includeBuilt));
    else out.push(path);
  }
  return out;
}

describe('what the package may import', () => {
  // The lint configuration lives in the repository this package is built in; a tree published
  // on its own has none, and the rule is checked before it leaves.
  it.skipIf(!existsSync(join(root, 'eslint.config.mjs')))(
    'refuses any @queryrev/* package, through the repository lint rule',
    async () => {
      const eslint = new ESLint({ cwd: root });
      const results = await eslint.lintText(`import { x } from '@queryrev/core';\nvoid x;\n`, {
        filePath: join(root, 'src', 'index.ts'),
      });
      const messages = (results[0]?.messages ?? []).map((message) => message.message);
      expect(messages.join('\n')).toContain('depends on no other workspace package');
    },
    SLOW,
  );

  it('declares no workspace dependency', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        expect(name.startsWith('@queryrev/'), `${field}: ${name}`).toBe(false);
        expect(range.startsWith('workspace:'), `${field}: ${name}`).toBe(false);
      }
    }
  });

  it('has no relative import that leaves the folder', () => {
    const specifier = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g;
    for (const file of filesUnder(join(root, 'src')).filter((path) => path.endsWith('.ts'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(specifier)) {
        const target = resolve(dirname(file), match[1]!);
        expect(
          target.startsWith(root.slice(0, -1)),
          `${relative(root, file)} imports ${match[1]}`,
        ).toBe(true);
      }
    }
  });
});

function buildPackage(): void {
  const run = spawnSync('npm', ['run', 'build', '--silent'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  expect(run.status, run.stderr || run.stdout).toBe(0);
}

describe('what a publish would carry', () => {
  // The package carries the built files, not the source: the build runs first, as it does
  // before a publish.
  const packedFiles = (): string[] => {
    buildPackage();
    const run = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    expect(run.status, run.stderr).toBe(0);
    return (JSON.parse(run.stdout) as { files: { path: string }[] }[])[0]!.files.map((file) =>
      file.path.split(sep).join('/'),
    );
  };

  it(
    'is the allowed files only, and the built files its entry points name',
    () => {
      const packed = packedFiles();
      const allowed =
        /^(package\.json|README\.md|LICENSE|CITATION\.cff|SECURITY\.md|(dist|data)\/.+)$/;
      for (const path of packed) {
        expect(allowed.test(path), path).toBe(true);
        expect(/\.test\.ts$|\.testkit\.ts$/.test(path), path).toBe(false);
      }
      for (const required of [
        'LICENSE',
        'README.md',
        'CITATION.cff',
        'SECURITY.md',
        'data/LICENSE',
        'dist/index.js',
        'dist/index.d.ts',
        'dist/cli.js',
      ]) {
        expect(packed, required).toContain(required);
      }
      // Every built file that package.json names is in the package. (In the repository the
      // entry points are source files for the workspace; the tree that is published names the
      // built ones, and the export test below checks that manifest.)
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as unknown;
      for (const target of stringsIn(manifest).filter((text) => text.startsWith('./dist/'))) {
        expect(packed, target).toContain(target.slice(2));
      }
    },
    SLOW,
  );
});

describe('the built files', () => {
  it(
    'carry no internal wording and no path of the machine that built them',
    () => {
      buildPackage();
      const built = filesUnder(join(root, 'dist'), true);
      expect(built.length).toBeGreaterThan(50);
      for (const file of built) {
        // The source builds the text of one bot-check page, a hosting platform's, from two parts so
        // the scan above passes; the bundler joins them. It is that platform's wording, which the
        // package looks for in other people's sites, and it is the one exception.
        const text = readFileSync(file, 'utf8').replaceAll(
          new RegExp(['ver', 'cel security checkpoint'].join(''), 'gi'),
          '',
        );
        for (const [what, pattern] of FORBIDDEN_IN_BUILT) {
          expect(pattern.test(text), `${relative(root, file)} contains ${what}`).toBe(false);
        }
      }
    },
    SLOW,
  );
});

/** Every string value anywhere in a JSON value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

// The script that builds the published tree lives in the repository, not in the package: these
// tests run where it exists.
describe('the export script', () => {
  const script = join(root, '..', '..', 'scripts', 'ai-readiness-export.mjs');
  const run = (target: string) =>
    spawnSync(process.execPath, [script, target, '--skip-lockfile'], { encoding: 'utf8' });
  const scratch = (): string => mkdtempSync(join(tmpdir(), 'export-test-'));

  it.skipIf(!existsSync(script))('refuses the filesystem root and the home folder', () => {
    for (const target of ['/', homedir()]) {
      const result = run(target);
      expect(result.status, target).toBe(2);
      expect(result.stderr).toContain('Refusing the output folder');
    }
  });

  it.skipIf(!existsSync(script))('refuses the repository and a folder that holds it', () => {
    expect(run(join(root, '..', '..')).status).toBe(2);
    expect(run(join(root, '..')).status).toBe(2);
    expect(run(root).status).toBe(2);
  });

  it.skipIf(!existsSync(script))(
    'refuses a folder that exists and is not empty, and keeps it',
    () => {
      const folder = scratch();
      try {
        writeFileSync(join(folder, 'keep.txt'), 'keep');
        const result = run(folder);
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('exists and is not empty');
        expect(readFileSync(join(folder, 'keep.txt'), 'utf8')).toBe('keep');
        expect(readdirSync(folder)).toEqual(['keep.txt']);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!existsSync(script))('builds into a new folder and into an empty one', () => {
    const parent = scratch();
    try {
      const fresh = join(parent, 'new');
      expect(run(fresh).status).toBe(0);
      expect(existsSync(join(fresh, 'package.json'))).toBe(true);
      const empty = join(parent, 'empty');
      mkdirSync(empty);
      expect(run(empty).status).toBe(0);
      const manifest = readFileSync(join(empty, 'package.json'), 'utf8');
      expect(manifest).not.toMatch(/catalog:|workspace:/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(script))(
    'writes a manifest that points at the built files, with nothing private left',
    () => {
      const parent = scratch();
      try {
        const tree = join(parent, 'tree');
        expect(run(tree).status).toBe(0);
        const text = readFileSync(join(tree, 'package.json'), 'utf8');
        const manifest = JSON.parse(text) as Record<string, unknown>;
        expect(manifest.private).toBeUndefined();
        expect((manifest.scripts as Record<string, string>).prepublishOnly).toContain(
          'scripts/check-publishable.mjs',
        );
        expect(manifest.version).toBe(ownManifest.version);
        expect(manifest.publishConfig).toEqual({ access: 'public' });
        expect(manifest.main).toBe('./dist/index.js');
        expect(manifest.types).toBe('./dist/index.d.ts');
        expect(Object.keys(manifest.exports as object)).toEqual(
          expect.arrayContaining(['.', './cli', './run', './testing']),
        );
        // Entry points are built files only: no source path, no development condition.
        const targets = stringsIn([manifest.exports, manifest.main, manifest.types, manifest.bin]);
        for (const target of targets.filter((entry) => entry !== './package.json')) {
          expect(target.startsWith('./dist/'), target).toBe(true);
        }
        expect(text).not.toMatch(/"development"|\.\/src\//);
        // The release notes are internal: they stay in the repository.
        expect(existsSync(join(tree, 'RELEASING.md'))).toBe(false);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );

  const guard = join(root, 'scripts', 'check-publishable.mjs');
  const runGuard = (folder: string) =>
    spawnSync(process.execPath, [guard, folder], { encoding: 'utf8' });
  const withChanges = (folder: string, changes: Record<string, unknown>): string => {
    const base = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as object;
    const changed = mkdtempSync(join(folder, 'guard-'));
    writeFileSync(join(changed, 'package.json'), JSON.stringify({ ...base, ...changes }));
    return changed;
  };

  it.skipIf(!existsSync(script))('refuses a publish from the repository folder, twice over', () => {
    // npm refuses a private package; prepublishOnly refuses a manifest that points at source.
    expect(ownManifest.private).toBe(true);
    expect(ownManifest.scripts?.prepublishOnly).toContain('scripts/check-publishable.mjs');
    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to publish');
    expect(result.stderr).toContain('"private" is true');
    expect(result.stderr).toContain('"main"');
  });

  it.skipIf(!existsSync(script))(
    'accepts the exported manifest and refuses one that points at source or is private',
    () => {
      const parent = scratch();
      try {
        const tree = join(parent, 'tree');
        expect(run(tree).status).toBe(0);
        expect(runGuard(tree).status).toBe(0);
        const exported = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8')) as {
          exports: Record<string, unknown>;
        };
        const cases: [string, Record<string, unknown>, string][] = [
          ['main in src', { main: './src/index.ts' }, '"main"'],
          ['no main', { main: undefined }, '"main"'],
          [
            'exports default in src',
            { exports: { ...exported.exports, '.': './src/index.ts' } },
            'exports["."].default',
          ],
          [
            'exports default in src (object)',
            { exports: { ...exported.exports, '.': { default: './src/index.ts' } } },
            'exports["."].default',
          ],
          ['private', { private: true }, '"private" is true'],
        ];
        for (const [name, changes, message] of cases) {
          const result = runGuard(withChanges(tree, changes));
          expect(result.status, name).toBe(1);
          expect(result.stderr, name).toContain(message);
        }
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!existsSync(script))(
    'brings the public repository workflows: no secret, actions pinned, publish by trusted publishing',
    () => {
      const parent = scratch();
      try {
        const tree = join(parent, 'tree');
        expect(run(tree).status).toBe(0);
        const release = readFileSync(join(tree, '.github', 'workflows', 'release.yml'), 'utf8');
        const ci = readFileSync(join(tree, '.github', 'workflows', 'ci.yml'), 'utf8');
        for (const [name, text] of [
          ['release.yml', release],
          ['ci.yml', ci],
        ] as const) {
          expect(text, name).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/);
          const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]!);
          expect(uses.length, name).toBeGreaterThan(0);
          for (const action of uses) expect(action, name).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
        }
        expect(release).toMatch(/tags:\s*\['v\*'\]/);
        expect(release).toMatch(/id-token:\s*write/);
        expect(release).toContain('npm ci --ignore-scripts');
        expect(release).toContain('npm publish --provenance --access public --ignore-scripts');
        expect(release).toMatch(/^ {4}environment: npm$/m);
        expect(release).toContain('node scripts/check-publishable.mjs');
        // The pull-request workflow can only read.
        expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
        expect(ci).not.toContain('id-token');
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );
});

describe('the published surface', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version: string;
    license: string;
    bin: Record<string, string>;
    files: string[];
    dependencies: Record<string, string>;
    private?: boolean;
    publishConfig?: { access?: string };
    repository?: { url?: string };
    engines?: { node?: string };
  };
  const read = (name: string): string => readFileSync(join(root, name), 'utf8');

  it('is private in the repository and public in the tree that is published', () => {
    // Where the export script exists this is the repository: npm refuses a publish from here.
    // The export test checks that the exported manifest drops `private`.
    const inRepository = existsSync(join(root, '..', '..', 'scripts', 'ai-readiness-export.mjs'));
    expect(manifest.private).toBe(inRepository ? true : undefined);
    expect(manifest.publishConfig).toEqual({ access: 'public' });
    expect(manifest.repository?.url).toBe('git+https://github.com/QueryRevAI/ai-readiness.git');
    expect(manifest.engines?.node).toBe('>=22.19');
    expect(manifest.version).toMatch(/^[1-9]\d*\.\d+\.\d+$/);
  });

  it('has one binary, built into dist, and one runtime dependency', () => {
    expect(manifest.bin).toEqual({ 'ai-readiness': './dist/cli.js' });
    expect(Object.keys(manifest.dependencies)).toEqual(['undici']);
  });

  it('carries the built files and the licence and citation files, and no source', () => {
    expect(manifest.files).toEqual([
      'dist',
      'data',
      'README.md',
      'LICENSE',
      'CITATION.cff',
      'SECURITY.md',
    ]);
  });

  it('keeps CITATION.cff in step with the package', () => {
    const citation = read('CITATION.cff');
    expect(citation).toMatch(/^cff-version: 1\.2\.0$/m);
    expect(citation).toMatch(/^title: ["']QueryRev AI Readiness["']$/m);
    expect(citation).toMatch(
      new RegExp(`^version: ${manifest.version.replaceAll('.', '\\.')}$`, 'm'),
    );
    expect(citation).toMatch(/^date-released: '\d{4}-\d{2}-\d{2}'$/m);
    expect(citation).toContain(`license: ${manifest.license}`);
    expect(citation).toContain('doi: 10.5281/zenodo.23424275');
    expect(citation).toContain('license: CC-BY-4.0');
    // The author is the organisation, not a person.
    expect(citation).toMatch(/authors:\n {2}- name: ["']QueryRev["']\n/);
    expect(citation).not.toMatch(/family-names|given-names/);
  });

  it('licenses the code as MIT and the data as CC BY 4.0', () => {
    expect(read('LICENSE')).toMatch(/^MIT License/);
    expect(read('data/LICENSE')).toContain('Attribution 4.0 International');
  });

  it('says the same crawlers line as every report, and documents the exit codes', () => {
    const readme = read('README.md');
    expect(readme).toContain(crawlersCoveredLine());
    for (const crawler of CRAWLERS) expect(readme).toContain(crawler.token);
    for (const code of ['0', '1', '2', '3', '4']) {
      expect(readme).toMatch(new RegExp(`^\\| ${code} {4}\\|`, 'm'));
    }
    expect(readme).toContain('security@queryrev.com');
    expect(readme).toContain('QueryRev-AIReadiness');
    expect(readme).toContain('10.5281/zenodo.23424275');
    expect(readme).not.toMatch(/--min-score|\bscores?\b.*\/ ?100/i);
  });

  it('has a security policy with the contact and the examples it names', () => {
    expect(read('SECURITY.md')).toContain('security@queryrev.com');
    for (const name of ['ci.sh', 'read-report.mjs', 'robots.txt', 'robots-check.sh']) {
      expect(existsSync(join(root, 'examples', name)), name).toBe(true);
    }
  });
});

describe('public text', () => {
  it('has no internal wording in any file of the folder', () => {
    // The lock file is generated from third-party package metadata, not written by us.
    for (const file of filesUnder(root).filter((path) => !path.endsWith('package-lock.json'))) {
      const text = readFileSync(file, 'utf8');
      for (const [what, pattern] of FORBIDDEN) {
        expect(pattern.test(text), `${relative(root, file)} contains ${what}`).toBe(false);
      }
    }
  });

  it('has the licence file', () => {
    expect(existsSync(join(root, 'LICENSE'))).toBe(true);
  });
});
