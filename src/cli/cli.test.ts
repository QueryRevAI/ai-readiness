import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CRAWLERS, crawlersCoveredLine } from '../crawlers';
import { AI_READINESS_USER_AGENT } from '../net/fetch-text';
import {
  GOOD_HOME,
  healthySite,
  LLMS,
  ORG,
  page,
  startRig,
  type Rig,
  type RunResult,
} from './cli.testkit';

// The command line, run in-process on a local fixture site (127.0.0.1, one port): golden JSON and
// exit codes for every command. Nothing here reaches the internet.

let rig: Rig;
beforeAll(async () => {
  rig = await startRig();
});
afterAll(async () => {
  await rig.close();
});
beforeEach(() => {
  rig.sites = { 'site.test': healthySite(rig.port) };
  rig.files.clear();
  rig.seen.length = 0;
  rig.fetcherCalls.length = 0;
});

const golden = (name: string): string => `../../golden/${name}.json`;
const jsonOf = (result: RunResult): unknown => JSON.parse(result.stdout);
const ESC = String.fromCharCode(27);
const BIDI = String.fromCharCode(0x202e);

/** The JSON document of a run, with the fixture port replaced, as the golden file holds it. */
const asGolden = (result: RunResult): string => `${rig.normalize(result.stdout).trimEnd()}\n`;

describe('crawlers', () => {
  it('lists the covered crawlers and the scope line', async () => {
    const result = await rig.run(['crawlers']);
    expect(result.code).toBe(0);
    for (const crawler of CRAWLERS) expect(result.stdout).toContain(crawler.token);
    expect(result.stdout).toContain(crawlersCoveredLine());
    expect(result.stdout).not.toContain('queryrev.com');
  });

  it('writes the golden JSON', async () => {
    const result = await rig.run(['crawlers', '--json']);
    expect(result.code).toBe(0);
    await expect(asGolden(result)).toMatchFileSnapshot(golden('crawlers'));
  });
});

describe('check', () => {
  it('writes the golden JSON for a healthy site and exits 0', async () => {
    const result = await rig.run(['check', rig.url(), '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const doc = jsonOf(result) as { schemaVersion: number; exitCode: number; summary: object };
    expect(doc.schemaVersion).toBe(1);
    expect(doc.exitCode).toBe(0);
    await expect(asGolden(result)).toMatchFileSnapshot(golden('check-healthy'));
  });

  it('prints the human report with the scope line, the limits and the full-report link', async () => {
    const result = await rig.run(['check', rig.url()]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('PASS');
    expect(result.stdout).toContain(crawlersCoveredLine());
    expect(result.stdout).toContain('Not seen:');
    expect(result.stdout).toMatch(
      /Full report: https:\/\/queryrev\.com\/tools\?utm_source=ai-readiness-cli&utm_medium=cli&/,
    );
  });

  it('keeps the full-report link out of the JSON', async () => {
    const result = await rig.run(['check', rig.url(), '--json']);
    expect(result.stdout).not.toContain('utm_');
  });

  it('exits 1 when a search crawler is kept out, and writes the golden JSON', async () => {
    rig.sites['site.test'] = healthySite(rig.port, {
      '/robots.txt': { type: 'text/plain', body: 'User-agent: OAI-SearchBot\nDisallow: /\n' },
    });
    const result = await rig.run(['check', rig.url(), '--json']);
    expect(result.code).toBe(1);
    await expect(asGolden(result)).toMatchFileSnapshot(golden('check-blocked'));
  });

  it('exits 0 on warnings by default and 1 with --fail-on warn', async () => {
    rig.sites['site.test'] = healthySite(rig.port, {
      '/': {
        type: 'text/html',
        body: '<html><head><title>x</title></head><body><main><p>few words</p></main></body></html>',
      },
    });
    expect((await rig.run(['check', rig.url()])).code).toBe(0);
    expect((await rig.run(['check', rig.url(), '--fail-on', 'warn'])).code).toBe(1);
    expect((await rig.run(['check', rig.url(), '--fail-on', 'fail'])).code).toBe(0);
  });

  it('exits 3 when robots.txt cannot be read, and says so in both modes', async () => {
    rig.sites['site.test'] = { '/robots.txt': { status: 503, type: 'text/plain', body: 'down' } };
    const human = await rig.run(['check', rig.url()]);
    expect(human.code).toBe(3);
    expect(human.stdout).toContain('The site could not be read: robots.txt answered 503');
    const json = await rig.run(['check', rig.url(), '--json']);
    expect(json.code).toBe(3);
    expect((jsonOf(json) as { error: { code: string } }).error.code).toBe('unreadable');
    await expect(asGolden(json)).toMatchFileSnapshot(golden('check-unreadable'));
  });

  it('exits 3 for a host that does not resolve and for an address it will not request', async () => {
    const unknown = await rig.run(['check', `http://nowhere.test:${rig.port}/`]);
    expect(unknown.code).toBe(3);
    expect(unknown.stdout).toContain('no answer');
    expect(unknown.stdout).toContain('--allow-private-network');
    const refused = await rig.run(['check', 'ftp://site.test/']);
    expect(refused.code).toBe(3);
  });

  it('sends the library user agent and asks the site only for its own files', async () => {
    await rig.run(['check', rig.url()]);
    expect(rig.seen.length).toBeGreaterThan(0);
    expect(rig.seen.every((entry) => entry.host === 'site.test')).toBe(true);
    expect(rig.seen.every((entry) => entry.agent === AI_READINESS_USER_AGENT)).toBe(true);
    expect(rig.seen.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['/robots.txt', '/', '/llms.txt', '/sitemap.xml']),
    );
  });

  it('passes --allow-private-network to the fetcher only when it is given', async () => {
    await rig.run(['check', rig.url()]);
    await rig.run(['check', rig.url(), '--allow-private-network']);
    expect(rig.fetcherCalls).toEqual([
      { allowPrivateNetwork: false },
      { allowPrivateNetwork: true },
    ]);
  });

  it('has no private-network option when the program that runs it offers none', async () => {
    const before = rig.fetcherCalls.length;
    const refused = await rig.run(['check', rig.url(), '--allow-private-network'], {
      offersPrivateNetwork: false,
    });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--allow-private-network');
    expect(rig.fetcherCalls.length).toBe(before);
    for (const command of [
      ['robots', 'test', rig.url()],
      ['llms', 'validate', rig.url()],
      ['llms', 'generate', rig.url()],
    ]) {
      const result = await rig.run([...command, '--allow-private-network'], {
        offersPrivateNetwork: false,
      });
      expect(result.code, command.join(' ')).toBe(2);
    }
    expect(rig.fetcherCalls.length).toBe(before);
  });

  it('mentions the private-network option only where it is offered', async () => {
    const unknownHost = rig.url('nobody.test');
    const offered = await rig.run(['check', unknownHost]);
    expect(offered.stdout).toContain('--allow-private-network');
    const notOffered = await rig.run(['check', unknownHost], { offersPrivateNetwork: false });
    expect(notOffered.stdout).not.toContain('--allow-private-network');
    expect(notOffered.stdout).not.toContain('private network');
    const generated = await rig.run(['llms', 'generate', unknownHost], {
      offersPrivateNetwork: false,
    });
    expect(generated.stdout + generated.stderr).not.toContain('--allow-private-network');
  });
});

describe('robots test', () => {
  const FILE = 'User-agent: *\nDisallow: /private\n\nUser-agent: GPTBot\nDisallow: /\n';

  it('reads a file offline and names the deciding line, with golden JSON', async () => {
    rig.files.set('robots.txt', FILE);
    const result = await rig.run([
      'robots',
      'test',
      'robots.txt',
      '--agent',
      'GPTBot',
      '--path',
      '/blog',
      '--json',
    ]);
    expect(result.code).toBe(1);
    expect(rig.seen).toHaveLength(0);
    const doc = jsonOf(result) as { match: { rule: { line: number; type: string } } };
    expect(doc.match.rule).toMatchObject({ line: 5, type: 'disallow' });
    await expect(asGolden(result)).toMatchFileSnapshot(golden('robots-test-agent'));
  });

  it('exits 0 when the crawler may fetch the path', async () => {
    rig.files.set('robots.txt', FILE);
    const result = await rig.run([
      'robots',
      'test',
      'robots.txt',
      '--agent',
      'OAI-SearchBot',
      '--path',
      '/blog',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('OAI-SearchBot may fetch /blog');
  });

  it('tests every covered crawler without --agent, with golden JSON', async () => {
    rig.files.set('robots.txt', FILE);
    const result = await rig.run(['robots', 'test', 'robots.txt', '--json']);
    expect(result.code).toBe(0);
    await expect(asGolden(result)).toMatchFileSnapshot(golden('robots-test-all'));
    const blocked = await rig.run(['robots', 'test', 'robots.txt', '--path', '/private/x']);
    expect(blocked.code).toBe(1);
    expect(blocked.stdout).toContain('FAIL');
  });

  it('treats a blocked training crawler as information, not failure', async () => {
    rig.files.set('robots.txt', 'User-agent: GPTBot\nDisallow: /\n');
    const result = await rig.run(['robots', 'test', 'robots.txt']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('INFO');
  });

  it('accepts any token and suggests only a covered crawler', async () => {
    rig.files.set('robots.txt', FILE);
    const typo = await rig.run(['robots', 'test', 'robots.txt', '--agent', 'GPTBott']);
    expect(typo.stdout).toContain('Did you mean GPTBot?');
    const other = await rig.run(['robots', 'test', 'robots.txt', '--agent', 'MyOwnBot']);
    expect(other.code).toBe(0);
    expect(other.stdout).toContain('not one of the crawlers this tool covers');
    expect(other.stdout).not.toContain('Did you mean');
  });

  it('reads robots.txt from a site, and a missing one allows everything', async () => {
    const open = await rig.run([
      'robots',
      'test',
      rig.url(),
      '--agent',
      'GPTBot',
      '--path',
      '/open',
    ]);
    expect(open.code).toBe(0);
    const closed = await rig.run([
      'robots',
      'test',
      rig.url(),
      '--agent',
      'GPTBot',
      '--path',
      '/private/a',
    ]);
    expect(closed.code).toBe(1);
    rig.sites['site.test'] = {};
    const missing = await rig.run(['robots', 'test', rig.url(), '--agent', 'GPTBot']);
    expect(missing.code).toBe(0);
    expect(missing.stdout).toContain('There is no robots.txt');
  });

  it('exits 3 when the site cannot be read', async () => {
    rig.sites['site.test'] = { '/robots.txt': { status: 500, body: 'error' } };
    const result = await rig.run(['robots', 'test', rig.url()]);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain('robots.txt could not be read');
  });

  it('exits 2 for a missing file and for an HTML page', async () => {
    const missing = await rig.run(['robots', 'test', 'nope.txt']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('No such file: nope.txt');
    rig.files.set('page.txt', '<!doctype html><html></html>');
    const html = await rig.run(['robots', 'test', 'page.txt']);
    expect(html.code).toBe(2);
  });
});

describe('llms validate', () => {
  it('validates a good file offline, with golden JSON', async () => {
    rig.files.set('llms.txt', LLMS);
    const result = await rig.run(['llms', 'validate', 'llms.txt', '--json']);
    expect(result.code).toBe(0);
    expect(rig.seen).toHaveLength(0);
    await expect(asGolden(result)).toMatchFileSnapshot(golden('llms-validate-file'));
  });

  it('fails a file that is a page, and one without an H1', async () => {
    rig.files.set('page.txt', '<!doctype html><html><body>hi</body></html>');
    const html = await rig.run(['llms', 'validate', 'page.txt']);
    expect(html.code).toBe(1);
    expect(html.stdout).toContain('soft 404');
    rig.files.set('plain.txt', 'just some text\n');
    expect((await rig.run(['llms', 'validate', 'plain.txt'])).code).toBe(1);
  });

  it('warns about a file with no summary or sections, and --fail-on warn then fails it', async () => {
    rig.files.set('thin.txt', '# Thin\n\nSome words.\n');
    expect((await rig.run(['llms', 'validate', 'thin.txt'])).code).toBe(0);
    expect((await rig.run(['llms', 'validate', 'thin.txt', '--fail-on', 'warn'])).code).toBe(1);
  });

  it('reads /llms.txt of a site and exits 1 when there is none, 3 when nothing answers', async () => {
    expect((await rig.run(['llms', 'validate', rig.url()])).code).toBe(0);
    rig.sites['site.test'] = {};
    const none = await rig.run(['llms', 'validate', rig.url()]);
    expect(none.code).toBe(1);
    expect(none.stdout).toContain('There is no llms.txt');
    const unreachable = await rig.run(['llms', 'validate', `http://nowhere.test:${rig.port}/`]);
    expect(unreachable.code).toBe(3);
  });

  it('checks the links of a site, and fails on a 404', async () => {
    const good = await rig.run(['llms', 'validate', rig.url(), '--links', '--json']);
    expect(good.code).toBe(0);
    await expect(asGolden(good)).toMatchFileSnapshot(golden('llms-validate-links'));
    rig.sites['site.test'] = healthySite(rig.port, {
      '/llms.txt': {
        type: 'text/plain',
        body: '# Fixture\n\n> Tests.\n\n## Guide\n\n- [Gone](/gone)\n- [Start](/guide/start)\n- [Elsewhere](https://other.example/page)\n',
      },
    });
    const bad = await rig.run(['llms', 'validate', rig.url(), '--links']);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain('1 of 2 checked links answer 404 or 410');
  });

  it('checks the links of a local file against --base, and needs --base for it', async () => {
    rig.files.set('llms.txt', LLMS);
    const result = await rig.run(['llms', 'validate', 'llms.txt', '--links', '--base', rig.url()]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('All 2 checked links');
    const missing = await rig.run(['llms', 'validate', 'llms.txt', '--links']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('--base');
  });

  it('does not request a link that robots.txt closes', async () => {
    rig.files.set('llms.txt', '# X\n\n> y\n\n## A\n\n- [Hidden](/private/hidden)\n');
    const result = await rig.run(['llms', 'validate', 'llms.txt', '--links', '--base', rig.url()]);
    expect(rig.seen.map((entry) => entry.path)).not.toContain('/private/hidden');
    expect(result.stdout).toContain('not allowed');
  });
});

describe('llms generate', () => {
  it('builds the file from the sitemap, writes it to standard output and the notes to standard error', async () => {
    const result = await rig.run(['llms', 'generate', rig.url()]);
    expect(result.code).toBe(0);
    expect(result.stdout.startsWith('# Fixture Co\n')).toBe(true);
    expect(result.stdout).toContain('## Guide');
    expect(result.stdout).not.toContain('/private/hidden');
    expect(result.stderr).toContain('3 pages from the sitemap');
    expect(result.stderr).toContain('closed to this reader by robots.txt');
    expect(result.stderr).toContain(
      'Full report: https://queryrev.com/tools?utm_source=ai-readiness-cli',
    );
    expect(rig.seen.map((entry) => entry.path)).not.toContain('/private/hidden');
  });

  it('writes the golden JSON', async () => {
    const result = await rig.run(['llms', 'generate', rig.url(), '--json']);
    expect(result.code).toBe(0);
    await expect(asGolden(result)).toMatchFileSnapshot(golden('llms-generate'));
  });

  it('writes --out, refuses to replace without --force, and prints a summary instead of the file', async () => {
    const first = await rig.run(['llms', 'generate', rig.url(), '--out', 'llms.txt']);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('Wrote llms.txt.');
    expect(first.stdout).not.toContain('## Guide');
    expect(rig.files.get('llms.txt')).toContain('## Guide');
    const again = await rig.run(['llms', 'generate', rig.url(), '--out', 'llms.txt']);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('--force');
    rig.files.set('llms.txt', 'old');
    const forced = await rig.run(['llms', 'generate', rig.url(), '--out', 'llms.txt', '--force']);
    expect(forced.code).toBe(0);
    expect(rig.files.get('llms.txt')).toContain('# Fixture Co');
  });

  it('honours --max-pages', async () => {
    const result = await rig.run(['llms', 'generate', rig.url(), '--max-pages', '2', '--json']);
    const doc = jsonOf(result) as { result: { pages: unknown[] } };
    expect(doc.result.pages).toHaveLength(2);
  });

  it('uses the links on the home page when the site lists no sitemap, and skips noindex pages', async () => {
    rig.sites['site.test'] = healthySite(rig.port, {
      '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow:\n' },
      '/blog/post': {
        type: 'text/html',
        body: page('Draft', 'Not yet', '<meta name="robots" content="noindex">'),
      },
    });
    const result = await rig.run(['llms', 'generate', rig.url(), '--json']);
    expect(result.code).toBe(0);
    const doc = jsonOf(result) as {
      result: { source: string; pages: { title: string }[]; skipped: { reason: string }[] };
    };
    expect(doc.result.source).toBe('home_links');
    expect(doc.result.pages.map((entry) => entry.title)).toEqual(['Fixture Co', 'Getting started']);
    expect(doc.result.skipped).toEqual([expect.objectContaining({ reason: 'noindex' })]);
  });

  it('asks a subdomain on its own robots.txt before listing a page from it', async () => {
    rig.sites['site.test'] = healthySite(rig.port, {
      '/sitemap.xml': {
        type: 'application/xml',
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://site.test:${rig.port}/guide/start</loc></url><url><loc>http://www.site.test:${rig.port}/closed/page</loc></url><url><loc>http://www.site.test:${rig.port}/open/page</loc></url></urlset>`,
      },
    });
    rig.sites['www.site.test'] = {
      '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /closed\n' },
      '/open/page': { type: 'text/html', body: page('Open page', 'Allowed there.') },
      '/closed/page': { type: 'text/html', body: page('Closed page', 'Not allowed.') },
    };
    const result = await rig.run(['llms', 'generate', rig.url(), '--json']);
    const doc = jsonOf(result) as {
      result: { pages: { title: string }[]; skipped: { url: string; reason: string }[] };
    };
    expect(doc.result.pages.map((entry) => entry.title)).toContain('Open page');
    expect(doc.result.pages.map((entry) => entry.title)).not.toContain('Closed page');
    const closed = doc.result.skipped.find((entry) => entry.url.includes('/closed/page'));
    expect(closed?.reason).toBe('robots');
    const onWww = rig.seen
      .filter((entry) => entry.host === 'www.site.test')
      .map((entry) => entry.path);
    expect(onWww[0]).toBe('/robots.txt');
    expect(onWww).not.toContain('/closed/page');
  });

  it('exits 3 when robots.txt cannot be read or nothing can be listed', async () => {
    rig.sites['site.test'] = { '/robots.txt': { status: 503, body: 'down' } };
    const down = await rig.run(['llms', 'generate', rig.url()]);
    expect(down.code).toBe(3);
    expect(down.stdout).toContain('Exit code 3.');
    rig.sites['site.test'] = {
      '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /\n' },
    };
    const closed = await rig.run(['llms', 'generate', rig.url()]);
    expect(closed.code).toBe(3);
    expect((await rig.run(['llms', 'generate', 'ftp://site.test'])).code).toBe(3);
  });
});

describe('usage errors exit 2', () => {
  const cases: [string, string[]][] = [
    ['no command', []],
    ['an unknown command', ['frobnicate']],
    ['robots alone', ['robots']],
    ['llms with a wrong subcommand', ['llms', 'scan']],
    ['a command that needs an address', ['check']],
    ['too many arguments', ['check', 'a.example', 'b.example']],
    ['an unknown option', ['check', 'a.example', '--min-score', '50']],
    ['the removed score command', ['score', 'a.example']],
    ['a wrong --fail-on', ['check', 'a.example', '--fail-on', 'info']],
    ['a wrong --max-pages', ['llms', 'generate', 'a.example', '--max-pages', '500']],
    [
      'a --max-pages that is not a number',
      ['llms', 'generate', 'a.example', '--max-pages', 'many'],
    ],
    ['a --path without a slash', ['robots', 'test', 'x.txt', '--path', 'blog']],
    ['a bad --agent', ['robots', 'test', 'x.txt', '--agent', 'a b']],
    ['an option of another command', ['crawlers', '--links']],
    ['--fail-on on generate', ['llms', 'generate', 'a.example', '--fail-on', 'warn']],
  ];
  for (const [name, argv] of cases) {
    it(`for ${name}`, async () => {
      const result = await rig.run(argv);
      expect(result.code).toBe(2);
      expect(rig.seen).toHaveLength(0);
      expect(result.stdout).toBe('');
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  }

  it('answers in JSON when --json is given', async () => {
    const result = await rig.run(['check', '--json']);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(jsonOf(result)).toMatchObject({
      schemaVersion: 1,
      exitCode: 2,
      error: { code: 'usage' },
    });
  });

  it('prints help and the version with exit 0', async () => {
    const help = await rig.run(['--help']);
    expect(help.code).toBe(0);
    for (const word of [
      'check',
      'robots test',
      'llms validate',
      'llms generate',
      'crawlers',
      '--fail-on',
    ]) {
      expect(help.stdout).toContain(word);
    }
    expect(help.stdout).not.toContain('--min-score');
    expect((await rig.run(['check', '--help'])).code).toBe(0);
    const version = await rig.run(['--version']);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe('internal errors', () => {
  it('exit 4, without a stack, in both modes', async () => {
    const human = await rig.runBroken(['check', 'a.example']);
    expect(human.code).toBe(4);
    expect(human.stderr).toBe('ai-readiness: Internal error: Error.\n');
    const json = await rig.runBroken(['check', 'a.example', '--json']);
    expect(json.code).toBe(4);
    expect(jsonOf(json)).toMatchObject({ exitCode: 4, error: { code: 'internal' } });
  });
});

describe('text from a site', () => {
  const evil = `${ESC}[31mRED${ESC}[0m${BIDI}evil${ESC}]0;title\u0007`;

  it('has its control and reordering characters removed in every output', async () => {
    rig.sites['site.test'] = healthySite(rig.port, {
      '/': {
        type: 'text/html',
        body: GOOD_HOME.replace('Fixture Co</title>', `${evil}</title>`).replace(
          JSON.stringify(ORG),
          JSON.stringify({ ...ORG, name: `Fixture ${evil}` }),
        ),
      },
      '/llms.txt': {
        type: 'text/plain',
        body: `# Fixture ${evil}\n\n> Tests.\n\n## Guide\n\n- [Start](/guide/start)\n`,
      },
      '/guide/start': { type: 'text/html', body: page(`Start ${evil}`, `About ${evil}`) },
    });
    const runs = [
      ['check', rig.url()],
      ['check', rig.url(), '--json'],
      ['llms', 'validate', rig.url()],
      ['llms', 'validate', rig.url(), '--json'],
      ['llms', 'generate', rig.url()],
      ['llms', 'generate', rig.url(), '--json'],
    ];
    for (const argv of runs) {
      const result = await rig.run(argv);
      const all = result.stdout + result.stderr;
      expect(all, argv.join(' ')).not.toContain(ESC);
      expect(all, argv.join(' ')).not.toContain(BIDI);
      expect(all, argv.join(' ')).not.toContain('\u0007');
    }
    const generated = await rig.run(['llms', 'generate', rig.url()]);
    expect(generated.stdout).toContain('[31mRED');
  });

  it('cannot start a new report line from a snippet', async () => {
    rig.files.set('llms.txt', '# Title\nPASS fake  forged line\n');
    const result = await rig.run(['llms', 'validate', 'llms.txt']);
    for (const line of result.stdout.split('\n')) {
      expect(line.startsWith('PASS')).toBe(false);
    }
  });
});

describe('colour', () => {
  it('is off without a terminal', async () => {
    expect((await rig.run(['check', rig.url()])).stdout).not.toContain(ESC);
  });

  it('is on at a terminal', async () => {
    const result = await rig.run(['check', rig.url()], { tty: true, env: {} });
    expect(result.stdout).toContain(`${ESC}[32mPASS${ESC}[0m`);
  });

  it('is off at a terminal when NO_COLOR is set, even empty-looking values count only when not empty', async () => {
    const off = await rig.run(['check', rig.url()], { tty: true, env: { NO_COLOR: '1' } });
    expect(off.stdout).not.toContain(ESC);
    const emptyValue = await rig.run(['check', rig.url()], { tty: true, env: { NO_COLOR: '' } });
    expect(emptyValue.stdout).toContain(ESC);
  });

  it('is off with --no-color, with TERM=dumb, and in JSON', async () => {
    expect((await rig.run(['check', rig.url(), '--no-color'], { tty: true })).stdout).not.toContain(
      ESC,
    );
    expect(
      (await rig.run(['check', rig.url()], { tty: true, env: { TERM: 'dumb' } })).stdout,
    ).not.toContain(ESC);
    expect((await rig.run(['check', rig.url(), '--json'], { tty: true })).stdout).not.toContain(
      ESC,
    );
  });
});

describe('the crawlers-covered line', () => {
  it('is in the human report and the JSON of every report about the covered list', async () => {
    rig.files.set('robots.txt', 'User-agent: *\nDisallow:\n');
    rig.files.set('llms.txt', LLMS);
    const line = crawlersCoveredLine();
    const reports: [string[], 'stdout' | 'stderr'][] = [
      [['check', rig.url()], 'stdout'],
      [['crawlers'], 'stdout'],
      [['robots', 'test', 'robots.txt'], 'stdout'],
      [['llms', 'validate', 'llms.txt'], 'stdout'],
      [['llms', 'generate', rig.url()], 'stderr'],
    ];
    for (const [argv, stream] of reports) {
      const result = await rig.run(argv);
      expect(result[stream], argv.join(' ')).toContain(line);
      const json = await rig.run([...argv, '--json']);
      expect(json.stdout, argv.join(' ')).toContain(JSON.stringify(line));
    }
  });

  it('is not in the test of one named crawler', async () => {
    rig.files.set('robots.txt', 'User-agent: *\nDisallow:\n');
    const result = await rig.run(['robots', 'test', 'robots.txt', '--agent', 'GPTBot']);
    expect(result.stdout).not.toContain('Crawlers covered');
  });
});

describe('no score', () => {
  it('appears nowhere in the output', async () => {
    const outputs = [
      await rig.run(['check', rig.url(), '--json']),
      await rig.run(['check', rig.url()]),
      await rig.run(['--help']),
    ];
    for (const result of outputs) expect(result.stdout.toLowerCase()).not.toMatch(/\bscore\b/);
  });
});
