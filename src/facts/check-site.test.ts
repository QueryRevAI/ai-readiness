import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureTextFetcher, tableResolver } from '../net/testing';
import type { TextFetcher } from '../net/fetch-text';
import { checkSite } from './check-site';
import { FINDING_IDS } from './findings';
import type { Finding, SiteCheck } from './types';

// A local fixture site on 127.0.0.1: one server answers for several names (by `Host`), each with
// a table of paths. Nothing here reaches the internet: the fixture guard allows 127.0.0.1 on
// one port and refuses everything else.

interface Answer {
  readonly status?: number;
  readonly type?: string;
  readonly body?: string | Buffer;
  readonly headers?: Record<string, string>;
}
type Site = Record<string, Answer | undefined>;

const words = (count: number): string => 'word '.repeat(count);
const org = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Fixture Co',
  url: 'https://site.test/',
  logo: 'https://site.test/logo.png',
  sameAs: ['https://www.linkedin.com/company/fixture', 'https://www.wikidata.org/wiki/Q1'],
};

const goodHome = `<!doctype html><html><head><title>Fixture</title><script type="application/ld+json">${JSON.stringify(org)}</script></head><body><main><h1>Fixture</h1><p>${words(200)}</p></main></body></html>`;
const urlset = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://site.test/a</loc></url><url><loc>https://site.test/b</loc></url></urlset>`;
const llms =
  '# Fixture\n\n> A site for tests.\n\n## Docs\n\n- [Start](https://site.test/start): begin here\n';

function healthy(extra: Site = {}): Site {
  return {
    '/robots.txt': {
      type: 'text/plain',
      body: `User-agent: *\nDisallow: /private\nSitemap: http://site.test:${port}/sitemap.xml\n`,
    },
    '/': { type: 'text/html; charset=utf-8', body: goodHome },
    '/llms.txt': { type: 'text/plain', body: llms },
    '/sitemap.xml': { type: 'application/xml', body: urlset },
    ...extra,
  };
}

let server: Server;
let port = 0;
let sites: Record<string, Site> = {};
const seen: { host: string; path: string; agent: string }[] = [];
let fetcher: TextFetcher;

function handle(req: IncomingMessage, res: ServerResponse): void {
  const host = (req.headers.host ?? '').split(':')[0]!;
  const path = req.url ?? '/';
  seen.push({ host, path, agent: String(req.headers['user-agent'] ?? '') });
  const answer = sites[host]?.[path];
  if (answer === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(answer.status ?? 200, {
    ...(answer.type === undefined ? {} : { 'content-type': answer.type }),
    ...answer.headers,
  });
  res.end(answer.body);
}

const resolver = tableResolver({
  'site.test': ['127.0.0.1'],
  'other.test': ['127.0.0.1'],
  'www.site.test': ['127.0.0.1'],
});

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// A fetcher for each test: a host that answered 429 or 503 gets no further request from it.
beforeEach(() => {
  sites = {};
  seen.length = 0;
  fetcher = createFixtureTextFetcher({ port, resolver, hostIntervalMs: 0 });
});

afterEach(async () => {
  await fetcher.close();
});

const check = (host = 'site.test'): Promise<SiteCheck> =>
  checkSite(`http://${host}:${port}/`, { fetcher });
const find = (result: SiteCheck, id: string): Finding | undefined =>
  result.findings.find((f) => f.id === id);
const paths = (host = 'site.test'): string[] =>
  seen.filter((s) => s.host === host).map((s) => s.path);

describe('a healthy site', () => {
  it('reads the four files in order and finds everything', async () => {
    sites['site.test'] = healthy();
    const result = await check();
    expect(paths()).toEqual(['/robots.txt', '/', '/llms.txt', '/sitemap.xml']);
    expect(seen.every((s) => s.agent.includes('QueryRev-AIReadiness/1.0'))).toBe(true);
    expect(result.schemaVersion).toBe(1);
    expect(result.robots).toMatchObject({ outcome: 'file', allowsThisReader: true });
    expect(result.home).toMatchObject({ outcome: 'read', status: 200, redirects: 0 });
    expect(result.home?.facts).toMatchObject({ content: 'text_in_html', organization: 'json_ld' });
    expect(result.llms).toMatchObject({
      asked: true,
      present: true,
      h1: 'Fixture',
      sections: 1,
      links: 1,
    });
    expect(result.sitemap).toMatchObject({ asked: true, source: 'robots', status: 200 });
    expect(result.sitemap.facts).toMatchObject({ outcome: 'valid', kind: 'urlset', locs: 2 });
    expect(result.crawlersCovered).toMatch(/^Crawlers covered:/);
    expect(result.crawlerAccess.length).toBeGreaterThan(5);

    const levels = Object.fromEntries(result.findings.map((f) => [f.id, f.level]));
    expect(levels).toMatchObject({
      'robots-txt': 'pass',
      'sitemap-in-robots': 'pass',
      'ai-search-crawler-access': 'pass',
      'ai-training-crawler-access': 'info',
      'home-page-read': 'pass',
      'noindex-home-page': 'pass',
      'text-in-html': 'pass',
      'json-ld-on-home-page': 'pass',
      'organization-schema': 'pass',
      'organization-name-and-url': 'pass',
      'organization-logo': 'pass',
      'organization-same-as': 'pass',
      'website-schema': 'info',
      'llms-txt-found': 'pass',
      'llms-txt-structure': 'pass',
      'sitemap-valid': 'pass',
    });
    expect(result.findings.some((f) => f.level === 'fail' || f.level === 'warn')).toBe(false);
  });

  it('gives every finding a known id, a docs link and no duplicate id', async () => {
    sites['site.test'] = healthy();
    const result = await check();
    const ids = result.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const finding of result.findings) {
      expect(FINDING_IDS).toContain(finding.id);
      expect(finding.docUrl).toMatch(
        /^https:\/\/queryrev\.com\/research\/ai-search-readiness#[a-z-]+$/,
      );
      expect(finding.message).not.toBe('');
    }
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('accepts a bare host name for the address, and refuses what cannot be checked', async () => {
    for (const input of [
      'ftp://site.test/',
      'http://127.0.0.1/',
      'http://user:pw@site.test/',
      'https://[::1]/',
      '',
    ]) {
      const result = await checkSite(input, { fetcher });
      expect(result.findings.map((f) => f.id)).toEqual(['site-refused']);
      expect(result.findings[0]).toMatchObject({ level: 'fail' });
      expect(result.home).toBeNull();
    }
    expect(seen).toEqual([]);
  });
});

describe('robots.txt', () => {
  it.each([
    [{ status: 500 }],
    [{ status: 503 }],
    [{ status: 403 }],
    [{ status: 401 }],
    [{ status: 429 }],
    [{ status: 202, type: 'text/html', body: '<html>wait</html>' }],
    [{ type: 'text/html', body: '<!DOCTYPE html><html><body>Just a moment...</body></html>' }],
  ] satisfies [Answer][])('stops everything when robots.txt answers %j', async (answer) => {
    sites['site.test'] = healthy({ '/robots.txt': answer });
    const result = await check();
    expect(result.robots.outcome).toBe('not_read');
    expect(paths()).toEqual(['/robots.txt']);
    expect(result.home).toBeNull();
    expect(result.sitemap.asked).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ id: 'robots-txt', level: 'warn' });
  });

  it('treats a 404 as "no file, nothing closed" and reads the rest', async () => {
    sites['site.test'] = healthy({
      '/robots.txt': { status: 404, type: 'text/plain', body: 'nope' },
    });
    const result = await check();
    expect(result.robots.outcome).toBe('missing');
    expect(paths()).toEqual(['/robots.txt', '/', '/llms.txt', '/sitemap.xml']);
    expect(result.sitemap.source).toBe('well_known');
    expect(find(result, 'robots-txt')?.level).toBe('info');
  });

  it('reads a home page in its own character set (a windows-1251 page, by its header)', async () => {
    const cyrillic = [0xef, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2];
    const body = Buffer.from([
      ...Buffer.from('<html><head></head><body><main>'),
      ...Array.from({ length: 200 }, () => [...cyrillic, 0x20]).flat(),
      ...Buffer.from('</main></body></html>'),
    ]);
    sites['site.test'] = healthy({
      '/': { type: 'text/html; charset=windows-1251', body },
    });
    const result = await check();
    expect(result.home?.facts?.mainWords).toBe(200);
  });

  it('follows its own token: a block keeps every other request away', async () => {
    sites['site.test'] = healthy({
      '/robots.txt': {
        type: 'text/plain',
        body: 'User-agent: QueryRev-AIReadiness\nDisallow: /\n',
      },
    });
    const result = await check();
    expect(paths()).toEqual(['/robots.txt']);
    expect(result.home).toMatchObject({ outcome: 'not_allowed', facts: null });
    expect(result.llms.asked).toBe(false);
    expect(result.sitemap.asked).toBe(false);
    expect(find(result, 'reader-blocked')).toBeDefined();
    expect(find(result, 'home-page-read')?.level).toBe('info');
  });

  it('asks only for the paths it allows', async () => {
    sites['site.test'] = healthy({
      '/robots.txt': {
        type: 'text/plain',
        body: 'User-agent: *\nDisallow: /llms.txt\nDisallow: /sitemap.xml\n',
      },
    });
    const result = await check();
    expect(paths()).toEqual(['/robots.txt', '/']);
    expect(result.llms.asked).toBe(false);
    expect(result.sitemap.asked).toBe(false);
    expect(find(result, 'llms-txt-found')?.level).toBe('info');
    expect(find(result, 'sitemap-valid')?.level).toBe('info');
  });

  it('reports the covered AI crawlers it closes', async () => {
    sites['site.test'] = healthy({
      '/robots.txt': {
        type: 'text/plain',
        body: 'User-agent: OAI-SearchBot\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /private\n',
      },
    });
    const result = await check();
    const search = find(result, 'ai-search-crawler-access');
    expect(search?.level).toBe('fail');
    expect(search?.snippet).toContain('OAI-SearchBot');
    expect(search?.snippet).not.toContain('GPTBot');
    expect(find(result, 'ai-training-crawler-access')?.snippet).toBe('GPTBot');
    expect(result.crawlerAccess.find((c) => c.token === 'OAI-SearchBot')).toMatchObject({
      access: 'blocked',
      root: false,
      purpose: 'search',
    });
    // The crawlers' rule does not stop this reader.
    expect(result.home?.outcome).toBe('read');
  });

  it('warns when a covered search crawler is closed only in part', async () => {
    sites['site.test'] = healthy({
      '/robots.txt': {
        type: 'text/plain',
        body: 'User-agent: PerplexityBot\nDisallow: /\nAllow: /public\n',
      },
    });
    const result = await check();
    expect(find(result, 'ai-search-crawler-access')?.level).toBe('fail');
    sites['site.test'] = healthy({
      '/robots.txt': {
        type: 'text/plain',
        body: 'User-agent: PerplexityBot\nDisallow: /docs\nUser-agent: *\nDisallow: /tmp\n',
      },
    });
    expect((await check()).findings.find((f) => f.id === 'ai-search-crawler-access')?.level).toBe(
      'warn',
    );
  });
});

describe('the home page', () => {
  it('flags an empty application shell', async () => {
    const shell = `<!doctype html><html><head><title>App</title><script>${'x'.repeat(6000)}</script></head><body><div id="root"></div></body></html>`;
    sites['site.test'] = healthy({ '/': { type: 'text/html', body: shell } });
    const result = await check();
    expect(result.home?.facts).toMatchObject({ content: 'app_shell', appRoot: true });
    expect(find(result, 'app-shell')?.level).toBe('fail');
    expect(find(result, 'text-in-html')).toBeUndefined();
    expect(find(result, 'organization-schema')?.level).toBe('warn');
  });

  it('flags noindex from the header', async () => {
    sites['site.test'] = healthy({
      '/': { type: 'text/html', body: goodHome, headers: { 'x-robots-tag': 'noindex, nofollow' } },
    });
    const result = await check();
    expect(find(result, 'noindex-home-page')).toMatchObject({ level: 'fail' });
    expect(find(result, 'noindex-home-page')?.snippet).toContain('X-Robots-Tag');
  });

  it('flags an Organization that is in microdata only', async () => {
    const micro = `<html><body><main><p>${words(200)}</p></main><div itemscope itemtype="https://schema.org/Organization"></div></body></html>`;
    sites['site.test'] = healthy({ '/': { type: 'text/html', body: micro } });
    const result = await check();
    expect(find(result, 'organization-microdata-only')?.level).toBe('warn');
    expect(find(result, 'organization-schema')).toBeUndefined();
    expect(find(result, 'json-ld-on-home-page')?.level).toBe('warn');
  });

  it('does not follow a redirect to another site, and never contacts it', async () => {
    sites['site.test'] = healthy({
      '/': { status: 301, headers: { location: `http://other.test:${port}/` } },
    });
    sites['other.test'] = healthy();
    const result = await check();
    expect(result.home).toMatchObject({ outcome: 'off_site', status: 301, facts: null });
    expect(paths('other.test')).toEqual([]);
    expect(find(result, 'home-page-read')?.level).toBe('warn');
  });

  it('follows a redirect within the registrable domain', async () => {
    sites['site.test'] = healthy({
      '/': { status: 301, headers: { location: `http://www.site.test:${port}/` } },
    });
    sites['www.site.test'] = { '/': { type: 'text/html', body: goodHome } };
    const result = await check();
    expect(result.home).toMatchObject({ outcome: 'read', redirects: 1 });
    expect(result.home?.finalUrl).toBe(`http://www.site.test:${port}/`);
  });

  it.each([
    [{ status: 403, type: 'text/html', body: 'no' }, 'forbidden'],
    [{ status: 404, type: 'text/html', body: 'no' }, 'error_status'],
    [{ status: 200, type: 'application/json', body: '{}' }, 'not_html'],
    [
      {
        status: 200,
        type: 'text/html',
        body: '<html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1></body></html>',
      },
      'placeholder',
    ],
    [
      {
        status: 200,
        type: 'text/html',
        body: '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>',
      },
      'challenge',
    ],
  ] satisfies [Answer, string][])('does not read %j (%s)', async (answer, outcome) => {
    sites['site.test'] = healthy({ '/': answer });
    const result = await check();
    expect(result.home?.outcome).toBe(outcome);
    expect(result.home?.facts).toBeNull();
    expect(find(result, 'text-in-html')).toBeUndefined();
    // The other files are still read.
    expect(find(result, 'llms-txt-found')?.level).toBe('pass');
  });

  it('reads the start of a page cut at 2 MiB and says so', async () => {
    const big = `<html><body><main><p>${words(200)}</p></main><!--${'x'.repeat(2 * 1024 * 1024)}--></body></html>`;
    sites['site.test'] = healthy({ '/': { type: 'text/html', body: big } });
    const result = await check();
    expect(result.home).toMatchObject({ outcome: 'read', truncated: true });
    expect(find(result, 'home-truncated')?.level).toBe('info');
    expect(find(result, 'text-in-html')?.level).toBe('pass');
  });
});

describe('llms.txt and the sitemap', () => {
  it('does not take an HTML page for an llms.txt or a sitemap', async () => {
    const page = {
      type: 'text/html',
      body: '<!doctype html><html><head><title>Page</title></head><body>Hello</body></html>',
    };
    sites['site.test'] = healthy({
      '/llms.txt': page,
      '/sitemap.xml': page,
      '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow:\n' },
    });
    const result = await check();
    expect(result.llms).toMatchObject({ asked: true, present: false, verdict: 'html' });
    expect(find(result, 'llms-txt-found')?.level).toBe('info');
    expect(result.sitemap.facts).toMatchObject({ outcome: 'not_a_sitemap', reason: 'html' });
    expect(find(result, 'sitemap-valid')?.level).toBe('warn');
    expect(find(result, 'sitemap-valid')?.message).toContain('HTML');
  });

  it('warns about an llms.txt with no section of links', async () => {
    sites['site.test'] = healthy({ '/llms.txt': { type: 'text/plain', body: '# Only a title\n' } });
    const result = await check();
    expect(find(result, 'llms-txt-found')?.level).toBe('pass');
    expect(find(result, 'llms-txt-structure')?.level).toBe('warn');
  });

  it('reads a gzip sitemap listed in robots.txt', async () => {
    sites['site.test'] = healthy({
      // The line names the real host and port, as a site's would.
      '/robots.txt': {
        type: 'text/plain',
        body: `User-agent: *\nSitemap: http://site.test:${port}/sitemap.xml.gz\n`,
      },
      '/sitemap.xml.gz': { type: 'application/gzip', body: gzipSync(Buffer.from(urlset)) },
    });
    const result = await check();
    expect(paths()).toContain('/sitemap.xml.gz');
    expect(paths()).not.toContain('/sitemap.xml');
    expect(result.sitemap).toMatchObject({ source: 'robots', status: 200 });
    expect(result.sitemap.facts).toMatchObject({ outcome: 'valid', gzip: true, locs: 2 });
  });

  it('reads a sitemap sent with a gzip content encoding', async () => {
    sites['site.test'] = healthy({
      '/sitemap.xml': {
        type: 'application/xml',
        body: gzipSync(Buffer.from(urlset)),
        headers: { 'content-encoding': 'gzip' },
      },
    });
    const result = await check();
    expect(result.sitemap.facts).toMatchObject({ outcome: 'valid', gzip: false });
  });

  it('ignores a Sitemap line on another registrable domain and reads /sitemap.xml', async () => {
    sites['site.test'] = healthy({
      '/robots.txt': {
        type: 'text/plain',
        body: 'User-agent: *\nSitemap: https://elsewhere.example.org/sitemap.xml\n',
      },
    });
    const result = await check();
    expect(result.sitemap.source).toBe('well_known');
    expect(find(result, 'sitemap-in-robots')?.level).toBe('pass');
  });

  it('says a sitemap with no page on the site is not valid', async () => {
    sites['site.test'] = healthy({
      '/sitemap.xml': {
        type: 'application/xml',
        body: urlset.replaceAll('site.test', 'else.example.org'),
      },
    });
    const result = await check();
    expect(result.sitemap.facts).toMatchObject({ outcome: 'malformed', reason: 'off_site' });
    expect(find(result, 'sitemap-valid')?.level).toBe('warn');
  });

  it('says a missing sitemap is not valid', async () => {
    sites['site.test'] = healthy({ '/sitemap.xml': undefined });
    const result = await check();
    expect(result.sitemap).toMatchObject({ asked: true, status: 404, facts: null });
    expect(find(result, 'sitemap-valid')?.level).toBe('warn');
  });
});

describe('limits', () => {
  it("ends with what it has read when the caller's budget is already spent", async () => {
    sites['site.test'] = healthy();
    const result = await checkSite(`http://site.test:${port}/`, {
      fetcher,
      signal: AbortSignal.abort(),
    });
    expect(result.robots.outcome).toBe('not_read');
    expect(result.home).toBeNull();
    expect(seen).toEqual([]);
  });

  it('closes the fetcher it made, and leaves one it was given', async () => {
    sites['site.test'] = healthy();
    await check();
    // The shared fetcher still works after a check.
    const again = await check();
    expect(again.robots.outcome).toBe('file');
    // The production fetcher refuses the fixture's port, without a connection or a throw.
    const own = await checkSite(`http://site.test:${port}/`);
    expect(own.robots.outcome).toBe('not_read');
  });
});
