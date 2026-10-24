import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CRAWLERS, crawlersCoveredLine } from '@queryrev/ai-readiness';
import { describe, expect, it } from 'vitest';

// The package is published on its own, so these are checked here: it takes nothing private
// beyond the checking code it serves, the files a publish would carry are the allowed ones, the
// registry description agrees with the package, and no file carries internal text.
//
// The tests run in two places. In the repository the checking code is a workspace package that
// is bundled into dist/. In the tree made by scripts/ai-readiness-export.mjs (the folder `mcp/`
// of the public repository, which has no eslint.config.mjs) it is the published
// @queryrev/ai-readiness, installed from npm, and dist/ imports it by name. Where the two differ
// the tests say which one they check.

const root = fileURLToPath(new URL('..', import.meta.url));
const SLOW = 120_000;
const read = (name: string): string => readFileSync(join(root, name), 'utf8');
const exportScript = join(root, '..', '..', 'scripts', 'ai-readiness-export.mjs');
const inRepository = existsSync(join(root, 'eslint.config.mjs'));
const LIBRARY = '@queryrev/ai-readiness';

interface Manifest {
  name: string;
  version: string;
  license: string;
  private?: boolean;
  mcpName: string;
  bin: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
  publishConfig?: { access?: string };
  repository: { type: string; url: string; directory: string };
  engines: { node: string };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}
const manifest = JSON.parse(read('package.json')) as Manifest;

// Built from parts so this file does not contain what it looks for.
const publicTextPatterns: [string, RegExp][] = [
  ['a model provider name', new RegExp(['anthro', 'pic'].join(''), 'i')],
  ['a model name', new RegExp(['clau', 'de'].join(''), 'i')],
  ['a chat product name', new RegExp(['chat', 'gpt'].join(''), 'i')],
  [
    'an editor or app that is a client',
    new RegExp(['\\bcur', 'sor\\b|wind', 'surf|co', 'pilot|\\bcl', 'ine\\b'].join(''), 'i'),
  ],
  ['an editor name', new RegExp(['vs ?', 'code'].join(''), 'i')],
  ['a statement about the technology underneath', /\bbuilt (?:on|with|using|by)\b/i],
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
    'an internal host',
    new RegExp(['rail', 'way|ver', 'cel|ing', 'est|ne', 'on\\.tech|sen', 'try'].join(''), 'i'),
  ],
];

function filesUnder(folder: string, includeBuilt = false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(folder)) {
    if (name === '.git' || name === 'node_modules' || name === '.turbo' || name === 'coverage')
      continue;
    if (name === 'dist' && !includeBuilt) continue;
    const path = join(folder, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, includeBuilt));
    else out.push(path);
  }
  return out;
}

const sourceFiles = (): string[] =>
  filesUnder(join(root, 'src')).filter(
    (path) => path.endsWith('.ts') && !/\.(?:test|testkit)\.ts$/.test(path),
  );

describe('what the package may import', () => {
  it('takes the checking code and nothing else of the workspace', () => {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const [name, range] of Object.entries(manifest[field])) {
        if (name === LIBRARY) {
          if (inRepository) {
            // A build input: the repository bundles it into dist.
            expect(field).toBe('devDependencies');
            expect(range).toBe('workspace:^');
          } else {
            // The published package installs the library from npm.
            expect(field).toBe('dependencies');
            expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
          }
        } else {
          expect(name.startsWith('@queryrev/'), `${field}: ${name}`).toBe(false);
          expect(range.startsWith('workspace:'), `${field}: ${name}`).toBe(false);
        }
      }
    }
  });

  it('pins the protocol SDK to one exact version', () => {
    if (inRepository) {
      expect(manifest.dependencies['@modelcontextprotocol/sdk']).toBe('catalog:');
      const workspace = readFileSync(join(root, '..', '..', 'pnpm-workspace.yaml'), 'utf8');
      expect(workspace).toMatch(/^ {2}'@modelcontextprotocol\/sdk': \d+\.\d+\.\d+$/m);
    } else {
      expect(manifest.dependencies['@modelcontextprotocol/sdk']).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('has no relative import that leaves the folder', () => {
    const specifier = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g;
    for (const file of filesUnder(join(root, 'src')).filter((path) => path.endsWith('.ts'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(specifier)) {
        const target = resolve(dirname(file), match[1]!);
        expect(
          target.startsWith(root.slice(0, -1)),
          `${relative(root, file)} imports ${match[1]}`,
        ).toBe(true);
      }
    }
  });

  it('never takes the private-network entry of the command line', () => {
    const forbidden = [
      /@queryrev\/ai-readiness\/cli/,
      /createCliTextFetcher/,
      /createPrivateNetworkGuard/,
      /classifyPrivateNetworkAddress/,
      /guardWithRules/,
      /--allow-private-network/,
      /\.\.\/ai-readiness\//,
    ];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(text), `${relative(root, file)} contains ${String(pattern)}`).toBe(
          false,
        );
      }
    }
  });

  it('reads no setting from the environment and no file', () => {
    const forbidden = [/process\.env|\benv\./, /from 'node:fs/, /from 'node:child_process/];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(text), `${relative(root, file)} contains ${String(pattern)}`).toBe(
          false,
        );
      }
    }
  });
});

describe('what a publish would carry', () => {
  it(
    'is the allowed files only',
    () => {
      const run = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: root,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
      expect(run.status, run.stderr).toBe(0);
      const packed = (JSON.parse(run.stdout) as { files: { path: string }[] }[])[0]!.files.map(
        (file) => file.path.split(sep).join('/'),
      );
      const allowed = /^(package\.json|README\.md|LICENSE|SECURITY\.md|server\.json|dist\/.+)$/;
      for (const path of packed) {
        expect(allowed.test(path), path).toBe(true);
        expect(/\.test\.|\.testkit\./.test(path), path).toBe(false);
      }
      for (const required of ['LICENSE', 'README.md', 'SECURITY.md', 'server.json']) {
        expect(packed).toContain(required);
      }
    },
    SLOW,
  );
});

describe('the registry description', () => {
  interface ServerJson {
    $schema: string;
    name: string;
    title: string;
    description: string;
    version: string;
    websiteUrl: string;
    repository: { url: string; source: string; subfolder?: string };
    packages: {
      registryType: string;
      registryBaseUrl: string;
      identifier: string;
      version: string;
      transport: { type: string };
      environmentVariables?: unknown;
    }[];
    remotes?: unknown;
  }
  const server = JSON.parse(read('server.json')) as ServerJson;

  it('follows the registry schema of 11 December 2025', () => {
    expect(server.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    );
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(server.name.length).toBeGreaterThanOrEqual(3);
    expect(server.name.length).toBeLessThanOrEqual(200);
    expect(server.description.length).toBeGreaterThanOrEqual(1);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.title.length).toBeLessThanOrEqual(100);
    expect(server.version).not.toMatch(/[\^~<>*x]|latest/);
    expect(server.repository.source).toBe('github');
    expect(new URL(server.websiteUrl).protocol).toBe('https:');
  });

  it('names the package and the registry name the package proves', () => {
    expect(server.name).toBe('com.queryrev/ai-readiness');
    expect(manifest.mcpName).toBe(server.name);
    expect(server.version).toBe(manifest.version);
    expect(server.packages).toHaveLength(1);
    const [pack] = server.packages;
    expect(pack).toMatchObject({
      registryType: 'npm',
      registryBaseUrl: 'https://registry.npmjs.org',
      identifier: manifest.name,
      version: manifest.version,
      transport: { type: 'stdio' },
    });
  });

  it('asks for no secret and describes no hosted endpoint', () => {
    expect(server.packages[0]!.environmentVariables).toBeUndefined();
    expect(server.remotes).toBeUndefined();
  });
});

describe('the published surface', () => {
  it('has one binary, built into dist, and the licence of the core', () => {
    // Written without `./`: npm 11 removes a bin that starts with it, with a warning.
    expect(manifest.bin).toEqual({ 'ai-readiness-mcp': 'dist/server.js' });
    expect(manifest.license).toBe('MIT');
    expect(read('LICENSE')).toMatch(/^MIT License\n/);
    if (inRepository) {
      expect(read('LICENSE')).toBe(
        readFileSync(join(root, '..', 'ai-readiness', 'LICENSE'), 'utf8'),
      );
    }
    expect(manifest.files).toEqual(['dist', 'server.json', 'README.md', 'LICENSE', 'SECURITY.md']);
  });

  it('is version 1.0.0, public in the tree that is published and private in the repository', () => {
    expect(manifest.version).toBe('1.0.0');
    // npm refuses a private package: a publish from the repository's folder cannot happen.
    expect(manifest.private).toBe(inRepository ? true : undefined);
    expect(manifest.publishConfig).toEqual({ access: 'public' });
    expect(manifest.engines.node).toBe('>=22.19');
  });

  it('says where the code is: the folder mcp of the library repository', () => {
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/QueryRevAI/ai-readiness.git',
      directory: 'mcp',
    });
    const server = JSON.parse(read('server.json')) as {
      repository: { url: string; source: string; subfolder: string };
    };
    expect(server.repository).toEqual({
      url: 'https://github.com/QueryRevAI/ai-readiness',
      source: 'github',
      subfolder: 'mcp',
    });
  });

  it('refuses a publish that is not the published manifest, and installs nothing at publish', () => {
    // prepublishOnly runs the guard (in the repository, the library's own copy of it) and then
    // the build. `private` stops the repository's folder; the guard checks the bin.
    expect(manifest.scripts['prepublishOnly']).toMatch(
      /^node (?:\.\.\/ai-readiness\/)?scripts\/check-publishable\.mjs (?:\. )?--bin-only && npm run build$/,
    );
    expect(manifest.scripts).not.toHaveProperty('postinstall');
    expect(manifest.scripts).not.toHaveProperty('install');
    expect(manifest.scripts).not.toHaveProperty('prepare');
  });

  it('documents the tools, the line, the agent and the contact', () => {
    const readme = read('README.md');
    expect(readme).toContain(crawlersCoveredLine());
    for (const tool of ['check', 'robots_test', 'llms_validate', 'llms_generate', 'crawlers']) {
      expect(readme).toContain(`\`${tool}\``);
    }
    expect(readme).toContain('security@queryrev.com');
    expect(readme).toContain('QueryRev-AIReadiness');
    expect(readme).toContain('any MCP client');
    expect(read('SECURITY.md')).toContain('security@queryrev.com');
    expect(readme).not.toMatch(/--min-score|\bscores?\b.*\/ ?100/i);
    expect(CRAWLERS.length).toBe(11);
  });

  it('has configuration snippets that are valid JSON and start the published package', () => {
    const blocks = [...read('README.md').matchAll(/```json\n([\s\S]*?)```/g)].map(
      (match) => match[1]!,
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const config = JSON.parse(block) as {
        mcpServers: Record<string, { command: string; args: string[] }>;
      };
      for (const entry of Object.values(config.mcpServers)) {
        expect(entry.command).toBe('npx');
        expect(entry.args).toContain(manifest.name);
      }
    }
  });
});

describe('public text', () => {
  it('has no internal wording in any file of the folder', () => {
    for (const file of filesUnder(root)) {
      // The lock file, written when the tree is built, lists other people's packages.
      if (file.endsWith('package-lock.json')) continue;
      const text = readFileSync(file, 'utf8');
      for (const [what, pattern] of publicTextPatterns) {
        expect(pattern.test(text), `${relative(root, file)} contains ${what}`).toBe(false);
      }
    }
  });

  // What is published is dist/, so it is scanned too, with a path of the machine that built it
  // added to the words above. (`pnpm test` and `npm test` build first.)
  it('has none in the built files, and no path of the machine that built them', () => {
    const built = filesUnder(join(root, 'dist'), true);
    expect(built.length).toBeGreaterThan(0);
    const paths: [string, RegExp][] = [
      ['a home folder path', new RegExp(['/ho', 'me/'].join(''))],
      ['a user folder path', new RegExp(['/Us', 'ers/'].join(''))],
      ['a drive path', new RegExp(['[A-Za-z]', ':\\\\'].join(''))],
    ];
    for (const file of built) {
      // The checking code builds the text of one bot-check page, a hosting platform's, from
      // two parts so its own scan passes; the bundler joins them. It is that platform's
      // wording, which the code looks for in other people's sites, and it is the one exception.
      const text = readFileSync(file, 'utf8').replaceAll(
        new RegExp(['ver', 'cel security checkpoint'].join(''), 'gi'),
        '',
      );
      // The crawler list names a chat product's crawler token, so that name is
      // data in the checking code, not wording; every other pattern applies.
      const applied = publicTextPatterns.filter(([what]) => what !== 'a chat product name');
      for (const [what, pattern] of [...applied, ...paths]) {
        expect(pattern.test(text), `${relative(root, file)} contains ${what}`).toBe(false);
      }
    }
  });
});

// The built server. `pnpm test` builds it first (the package's test script); the tests do not
// skip when it is missing, so a run that did not build fails instead of passing without them.
describe('the built server', () => {
  const entry = join(root, 'dist', 'server.js');

  it('exists, so the tests below run (run the package tests with `pnpm test`)', () => {
    expect(existsSync(entry)).toBe(true);
  });

  it('imports the checking code by name when published, and bundles it in the repository', () => {
    const files = filesUnder(join(root, 'dist'), true).filter((path) => path.endsWith('.js'));
    const text = files.map((path) => readFileSync(path, 'utf8')).join('\n');
    const imported = /from ['"]@queryrev\/ai-readiness(?:\/[a-z-]+)?['"]/.test(text);
    expect(imported).toBe(!inRepository);
    // Either way the entry of the command line, with the private-network door, is never taken.
    expect(text).not.toMatch(/from ['"]@queryrev\/ai-readiness\/(?:cli|testing)/);
  });

  it('holds no code of the private-network door of the command line', () => {
    const bundle = readFileSync(entry, 'utf8');
    for (const name of [
      'createCliTextFetcher',
      'createPrivateNetworkGuard',
      'classifyPrivateNetworkAddress',
      'PRIVATE_NETWORK_REASONS',
      'METADATA_IN_PRIVATE_RANGES',
    ]) {
      expect(bundle.includes(name), name).toBe(false);
    }
  });

  it(
    'starts over real standard input and output, lists its tools and answers',
    async () => {
      const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await client.connect(transport);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual(
          ['check', 'crawlers', 'llms_generate', 'llms_validate', 'robots_test'].sort(),
        );
        const result = await client.callTool({ name: 'crawlers', arguments: {} });
        const text = (result.content as { text: string }[])[0]!.text;
        expect(JSON.parse(text)).toMatchObject({ schemaVersion: 1, command: 'crawlers' });
        const refused = await client.callTool({
          name: 'check',
          arguments: { url: 'file:///etc/passwd' },
        });
        expect(refused.isError).toBe(true);
        // The private network is refused by the built server too, with no way to ask for it.
        const local = await client.callTool({
          name: 'check',
          arguments: { url: 'http://localhost/' },
        });
        const body = JSON.parse((local.content as { text: string }[])[0]!.text) as {
          exitCode: number;
        };
        expect(body.exitCode).toBe(3);
      } finally {
        await client.close();
      }
    },
    SLOW,
  );
});

// The script that builds the published tree lives in the repository, not in the package: these
// tests run where it exists. They use --skip-lockfile, so no network is needed; the install,
// the tests and the build in the tree are the export dry run (see RELEASING.md).
describe('the export of the server', () => {
  const run = (target: string) =>
    spawnSync(process.execPath, [exportScript, target, '--package', 'mcp', '--skip-lockfile'], {
      encoding: 'utf8',
    });
  const scratch = (): string => mkdtempSync(join(tmpdir(), 'mcp-export-test-'));
  const fileTexts = (folder: string): Map<string, string> =>
    new Map(
      filesUnder(folder, true).map((path) => [
        relative(folder, path).split(sep).join('/'),
        readFileSync(path, 'utf8'),
      ]),
    );

  it.skipIf(!existsSync(exportScript))(
    'writes the folder mcp and the two workflows, and nothing else',
    () => {
      const parent = scratch();
      try {
        const out = join(parent, 'overlay');
        const result = run(out);
        expect(result.status, result.stderr).toBe(0);
        const files = [...fileTexts(out).keys()].sort();
        expect(readdirSync(out).sort()).toEqual(['.github', 'mcp']);
        expect(files).toEqual(
          expect.arrayContaining([
            '.github/workflows/ci-mcp.yml',
            '.github/workflows/release-mcp.yml',
            'mcp/.gitattributes',
            'mcp/.gitignore',
            'mcp/LICENSE',
            'mcp/README.md',
            'mcp/SECURITY.md',
            'mcp/package.json',
            'mcp/scripts/check-publishable.mjs',
            'mcp/server.json',
            'mcp/src/server.ts',
            'mcp/tsconfig.json',
            'mcp/vite.build.config.ts',
          ]),
        );
        // The workflows of the library are not touched: the overlay brings only its own two.
        expect(files.filter((path) => path.startsWith('.github/'))).toEqual([
          '.github/workflows/ci-mcp.yml',
          '.github/workflows/release-mcp.yml',
        ]);
        // No monorepo configuration, no notes for the maintainers, no build output.
        expect(
          files.filter((path) =>
            /eslint\.config|RELEASING|node_modules|\.turbo|(^|\/)dist\//.test(path),
          ),
        ).toEqual([]);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it.skipIf(!existsSync(exportScript))(
    'writes a manifest that is public, installs the library from npm, and guards the publish',
    () => {
      const parent = scratch();
      try {
        const out = join(parent, 'overlay');
        expect(run(out).status).toBe(0);
        const text = readFileSync(join(out, 'mcp', 'package.json'), 'utf8');
        const exported = JSON.parse(text) as Manifest;
        expect(text).not.toMatch(/catalog:|workspace:/);
        expect(exported.private).toBeUndefined();
        expect(exported.version).toBe(manifest.version);
        expect(exported.mcpName).toBe(manifest.mcpName);
        expect(exported.repository).toEqual(manifest.repository);
        const library = JSON.parse(
          readFileSync(join(root, '..', 'ai-readiness', 'package.json'), 'utf8'),
        ) as { version: string };
        // The oldest release of the library that is published and that the server works with.
        expect(exported.dependencies[LIBRARY]).toBe('^1.0.0');
        const floor = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(exported.dependencies[LIBRARY]!)!;
        const have = library.version.split('.').map(Number);
        expect([Number(floor[1]), Number(floor[2]), Number(floor[3])]).toSatisfy(
          (want: number[]) =>
            want[0] === have[0] &&
            (want[1]! < have[1]! || (want[1] === have[1] && want[2]! <= have[2]!)),
        );
        expect(exported.devDependencies).not.toHaveProperty(LIBRARY);
        expect(exported.scripts['prepublishOnly']).toBe(
          'node scripts/check-publishable.mjs --bin-only && npm run build',
        );
        expect(exported.scripts).not.toHaveProperty('lint');
        expect(exported.scripts['test']).toBe(manifest.scripts['test']);
        // The server.json that the tree carries is the repository's own, byte for byte.
        expect(readFileSync(join(out, 'mcp', 'server.json'), 'utf8')).toBe(read('server.json'));
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it.skipIf(!existsSync(exportScript))(
    'has a guard that refuses the repository folder and a manifest with its bin in the source',
    () => {
      const repositoryGuard = join(root, '..', 'ai-readiness', 'scripts', 'check-publishable.mjs');
      const guard = (folder: string, script = repositoryGuard) =>
        spawnSync(process.execPath, [script, folder, '--bin-only'], { encoding: 'utf8' });
      // npm refuses a private package; the guard says why, too.
      const refused = guard(root);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('"private" is true');

      const parent = scratch();
      try {
        const out = join(parent, 'overlay');
        expect(run(out).status).toBe(0);
        const tree = join(out, 'mcp');
        const copy = join(tree, 'scripts', 'check-publishable.mjs');
        // The copy in the tree is the library's script.
        expect(readFileSync(copy, 'utf8')).toBe(readFileSync(repositoryGuard, 'utf8'));
        expect(guard(tree, copy).status).toBe(0);
        const exported = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8')) as object;
        const cases: [string, Record<string, unknown>, string][] = [
          ['bin in src', { bin: { 'ai-readiness-mcp': 'src/bin.ts' } }, 'bin "ai-readiness-mcp"'],
          ['bin as a string in src', { bin: 'src/bin.ts' }, 'bin "@queryrev/ai-readiness-mcp"'],
          [
            'bin starting with ./',
            { bin: { 'ai-readiness-mcp': './dist/server.js' } },
            'bin "ai-readiness-mcp"',
          ],
          ['no bin', { bin: undefined }, '"bin" is missing'],
          ['private', { private: true }, '"private" is true'],
        ];
        for (const [name, changes, message] of cases) {
          const changed = mkdtempSync(join(parent, 'guard-'));
          writeFileSync(join(changed, 'package.json'), JSON.stringify({ ...exported, ...changes }));
          const result = guard(changed, copy);
          expect(result.status, name).toBe(1);
          expect(result.stderr, name).toContain(message);
        }
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it.skipIf(!existsSync(exportScript))(
    'brings workflows with no secret, pinned actions, and a release that is tied to mcp-v tags',
    () => {
      const parent = scratch();
      try {
        const out = join(parent, 'overlay');
        expect(run(out).status).toBe(0);
        const texts = fileTexts(out);
        const release = texts.get('.github/workflows/release-mcp.yml')!;
        const ci = texts.get('.github/workflows/ci-mcp.yml')!;
        for (const [name, text] of [
          ['release-mcp.yml', release],
          ['ci-mcp.yml', ci],
        ] as const) {
          expect(text, name).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/);
          const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]!);
          expect(uses.length, name).toBeGreaterThan(0);
          for (const action of uses) expect(action, name).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
          // Everything runs in the folder of the package.
          expect(text, name).toMatch(/^defaults:\n {2}run:\n {4}working-directory: mcp$/m);
        }
        // Started by mcp-v tags only; the library's release is started by v<digit> tags, and the
        // two patterns cannot match the same tag.
        expect(release).toMatch(/tags:\s*\['mcp-v\*'\]/);
        expect(release).toMatch(/^ {4}environment: npm$/m);
        expect(release).toMatch(/id-token:\s*write/);
        expect(release).toContain('npm ci --ignore-scripts');
        expect(release).toContain(
          'npm stage publish --provenance --access public --ignore-scripts',
        );
        // The trusted publisher allows staging only, so a direct publish would be refused.
        expect(release).not.toMatch(/npm publish\b/);
        expect(release).toContain('node scripts/check-publishable.mjs --bin-only');
        // The tag has to equal the version in package.json (and server.json equal it too), and
        // the commit has to be on main.
        expect(release).toContain('"$TAG_NAME" != "mcp-v$version"');
        expect(release).toContain('"$registry_version" != "$version"');
        expect(release).toContain("origin/main$'");
        // The pull-request workflow can only read.
        expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
        expect(ci).not.toContain('id-token');
        expect(ci).not.toContain('npm publish');
        // The library's release does not run for these tags.
        const libraryRelease = readFileSync(
          join(root, '..', '..', 'scripts', 'ai-readiness-public', 'release.yml'),
          'utf8',
        );
        const libraryTags = /tags:\s*\['([^']+)'\]/.exec(libraryRelease)![1]!;
        expect(libraryTags).toBe('v[0-9]*');
        const asRegExp = new RegExp(`^${libraryTags.replace('*', '.*')}$`);
        expect(asRegExp.test('v1.2.3')).toBe(true);
        expect(asRegExp.test('mcp-v1.0.0')).toBe(false);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it.skipIf(!existsSync(exportScript))('carries no internal wording in the tree', () => {
    const parent = scratch();
    try {
      const out = join(parent, 'overlay');
      expect(run(out).status).toBe(0);
      for (const [path, text] of fileTexts(out)) {
        if (/\.test\.ts$/.test(path)) continue;
        for (const [what, pattern] of publicTextPatterns) {
          expect(pattern.test(text), `${path} contains ${what}`).toBe(false);
        }
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
