import { describe, expect, it } from 'vitest';
import type { FetchTextOptions, TextFetcher, TextFetchResult } from '../net/fetch-text';
import { llmsFindings } from './findings';
import { checkLlmsLinks, LLMS_LINKS_MAX, llmsLinkFindings } from './links';
import { validateLlmsTxt } from './index';

// A fetcher that answers from a table: a status, or null for no answer. Nothing is requested
// over a network.
function stubFetcher(
  answers: Record<string, number | null>,
  bodies: Record<string, string> = {},
): TextFetcher & {
  readonly delays: [string, number | null][];
  readonly requested: string[];
  readonly options: FetchTextOptions[];
} {
  const requested: string[] = [];
  const options: FetchTextOptions[] = [];
  const delays: [string, number | null][] = [];
  return {
    delays,
    requested,
    options,
    fetchText(url, option) {
      requested.push(url);
      options.push(option);
      const status = answers[url];
      if (status === undefined) {
        return Promise.resolve({
          outcome: 'response',
          status: 404,
          text: 'missing',
          contentType: 'text/plain',
        } as unknown as TextFetchResult);
      }
      return Promise.resolve(
        (status === null
          ? { outcome: 'timeout', status: null, text: null, contentType: null }
          : {
              outcome: 'response',
              status,
              text: bodies[url] ?? 'ok',
              contentType: 'text/plain',
            }) as unknown as TextFetchResult,
      );
    },
    setCrawlDelay: (host, seconds) => {
      delays.push([host, seconds]);
    },
    isStopped: () => false,
    close: () => Promise.resolve(),
  };
}

const BASE = 'https://site.example';

describe('checkLlmsLinks', () => {
  it('checks same-site links only, resolves relative ones, drops fragments and duplicates', async () => {
    const fetcher = stubFetcher({
      'https://site.example/robots.txt': 200,
      'https://site.example/a': 200,
      'https://site.example/b': 200,
    });
    const report = await checkLlmsLinks(
      [
        '/a',
        '/a#top',
        'b',
        'https://other.example/x',
        'mailto:me@site.example',
        'ftp://site.example/f',
      ],
      { fetcher, base: `${BASE}/` },
    );
    expect(report.results.map((entry) => [entry.url, entry.outcome])).toEqual([
      ['https://site.example/a', 'ok'],
      ['https://site.example/b', 'ok'],
    ]);
    expect(report.skipped).toBe(3);
    expect(fetcher.requested).toEqual([
      'https://site.example/robots.txt',
      'https://site.example/a',
      'https://site.example/b',
    ]);
  });

  it('reads at most 64 KiB of a link and stops at the first 20', async () => {
    const targets = Array.from({ length: 25 }, (_, index) => `/page-${index}`);
    const answers: Record<string, number> = { 'https://site.example/robots.txt': 404 };
    for (const target of targets) answers[`${BASE}${target}`] = 200;
    const fetcher = stubFetcher(answers);
    const report = await checkLlmsLinks(targets, { fetcher, base: BASE });
    expect(report.results).toHaveLength(LLMS_LINKS_MAX);
    expect(report.beyondLimit).toBe(5);
    expect(fetcher.options.slice(1).every((option) => option.maxBytes === 64 * 1024)).toBe(true);
    expect(fetcher.options.slice(1).every((option) => option.kind === 'page')).toBe(true);
  });

  it('sorts answers into ok, missing, error and unreachable', async () => {
    const fetcher = stubFetcher({
      'https://site.example/robots.txt': 404,
      'https://site.example/ok': 200,
      'https://site.example/gone': 410,
      'https://site.example/err': 500,
      'https://site.example/down': null,
    });
    const report = await checkLlmsLinks(['/ok', '/gone', '/err', '/down'], { fetcher, base: BASE });
    expect(report.results.map((entry) => entry.outcome)).toEqual([
      'ok',
      'missing',
      'error_status',
      'unreachable',
    ]);
    const findings = llmsLinkFindings(report);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: 'llms-txt-links', level: 'fail' });
  });

  it('warns, not fails, when links answer 5xx or nothing', async () => {
    const fetcher = stubFetcher({
      'https://site.example/robots.txt': 404,
      'https://site.example/err': 503,
    });
    const report = await checkLlmsLinks(['/err'], { fetcher, base: BASE });
    expect(llmsLinkFindings(report)[0]).toMatchObject({ level: 'warn' });
  });

  it('does not request a link that robots.txt closes, nor any link when robots.txt is unreadable', async () => {
    const closed = stubFetcher({ 'https://site.example/robots.txt': 200 });
    const original = closed.fetchText.bind(closed);
    closed.fetchText = async (url, option) => {
      const result = await original(url, option);
      return url.endsWith('/robots.txt')
        ? { ...result, text: 'User-agent: *\nDisallow: /secret\n' }
        : result;
    };
    const report = await checkLlmsLinks(['/secret/a', '/open'], { fetcher: closed, base: BASE });
    expect(report.results.map((entry) => entry.outcome)).toEqual(['not_allowed', 'missing']);
    expect(closed.requested).not.toContain('https://site.example/secret/a');

    const down = stubFetcher({ 'https://site.example/robots.txt': 503 });
    const none = await checkLlmsLinks(['/a'], { fetcher: down, base: BASE });
    expect(none.robotsRead).toBe(false);
    expect(down.requested).toEqual(['https://site.example/robots.txt']);
    expect(llmsLinkFindings(none)[0]).toMatchObject({ level: 'warn' });
  });

  it('has nothing to check in a file with no link on the site', async () => {
    const fetcher = stubFetcher({});
    const report = await checkLlmsLinks(['https://other.example/x'], { fetcher, base: BASE });
    expect(fetcher.requested).toEqual([]);
    expect(llmsLinkFindings(report)[0]).toMatchObject({ level: 'info' });
  });
});

describe('checkLlmsLinks: robots.txt per origin, crawl delay and time budget', () => {
  it("asks a subdomain on its own robots.txt, not the base origin's", async () => {
    const fetcher = stubFetcher(
      {
        'https://site.example/robots.txt': 404,
        'https://www.site.example/robots.txt': 200,
        'https://www.site.example/ok': 200,
        'https://site.example/a': 200,
      },
      { 'https://www.site.example/robots.txt': 'User-agent: *\nDisallow: /closed\n' },
    );
    const report = await checkLlmsLinks(
      ['/a', 'https://www.site.example/closed', 'https://www.site.example/ok'],
      {
        fetcher,
        base: BASE,
      },
    );
    expect(report.results.map((entry) => [entry.url, entry.outcome])).toEqual([
      ['https://site.example/a', 'ok'],
      ['https://www.site.example/closed', 'not_allowed'],
      ['https://www.site.example/ok', 'ok'],
    ]);
    expect(fetcher.requested).toEqual([
      'https://site.example/robots.txt',
      'https://site.example/a',
      'https://www.site.example/robots.txt',
      'https://www.site.example/ok',
    ]);
  });

  it('asks the other scheme on its own robots.txt, and does not request when that cannot be read', async () => {
    const fetcher = stubFetcher({
      'https://site.example/robots.txt': 404,
      'http://site.example/robots.txt': 503,
    });
    const report = await checkLlmsLinks(['http://site.example/plain'], { fetcher, base: BASE });
    expect(report.results).toEqual([
      { url: 'http://site.example/plain', outcome: 'robots_unreadable', status: null },
    ]);
    expect(fetcher.requested).not.toContain('http://site.example/plain');
  });

  it('passes the Crawl-delay of each origin to the fetcher, capped at 10 seconds', async () => {
    const fetcher = stubFetcher(
      { 'https://site.example/robots.txt': 200, 'https://site.example/a': 200 },
      { 'https://site.example/robots.txt': 'User-agent: *\nCrawl-delay: 30\n' },
    );
    await checkLlmsLinks(['/a'], { fetcher, base: BASE });
    expect(fetcher.delays).toEqual([['site.example', 10]]);
    const small = stubFetcher(
      { 'https://site.example/robots.txt': 200 },
      { 'https://site.example/robots.txt': 'User-agent: QueryRev-AIReadiness\nCrawl-delay: 3\n' },
    );
    await checkLlmsLinks(['/a'], { fetcher: small, base: BASE });
    expect(small.delays).toEqual([['site.example', 3]]);
  });

  it('reports links not yet asked when the time budget ends as not checked, not unreachable', async () => {
    const controller = new AbortController();
    const fetcher = stubFetcher({
      'https://site.example/robots.txt': 404,
      'https://site.example/one': 200,
      'https://site.example/two': 200,
      'https://site.example/three': 200,
    });
    const original = fetcher.fetchText.bind(fetcher);
    fetcher.fetchText = async (url, option) => {
      if (url.endsWith('/two')) {
        controller.abort();
        return {
          outcome: 'budget_exceeded',
          status: null,
          text: null,
          contentType: null,
        } as unknown as TextFetchResult;
      }
      return original(url, option);
    };
    const report = await checkLlmsLinks(['/one', '/two', '/three'], {
      fetcher,
      base: BASE,
      signal: controller.signal,
    });
    expect(report.results.map((entry) => entry.outcome)).toEqual([
      'ok',
      'not_checked',
      'not_checked',
    ]);
    expect(fetcher.requested).not.toContain('https://site.example/three');
    const [finding] = llmsLinkFindings(report);
    expect(finding!.message).toContain('2 not checked (time budget)');
    expect(finding!.message).not.toContain('unreachable');
  });
});

describe('llmsFindings', () => {
  const answer = (
    body: string | null,
    status: number | null = 200,
    type: string | null = 'text/plain',
  ) => validateLlmsTxt({ status, contentType: type, body, truncated: false });

  it('passes a complete file', () => {
    const findings = llmsFindings(
      answer('# Name\n\n> Summary.\n\n## Guide\n\n- [A](https://x.example/a)\n'),
    );
    expect(findings.map((finding) => [finding.id, finding.level])).toEqual([
      ['llms-txt-found', 'pass'],
      ['llms-txt-h1', 'pass'],
      ['llms-txt-summary', 'pass'],
      ['llms-txt-sections', 'pass'],
    ]);
  });

  it('warns about a second H1, a missing summary and missing sections', () => {
    const findings = llmsFindings(answer('# One\n\n# Two\n'));
    expect(
      findings.filter((finding) => finding.level === 'warn').map((finding) => finding.id),
    ).toEqual(['llms-txt-h1', 'llms-txt-summary', 'llms-txt-sections']);
  });

  it('fails each answer that is not an llms.txt, with its own sentence', () => {
    const sentences = new Set(
      [
        answer(null, null),
        answer('gone', 404),
        answer('error', 500),
        answer('{}', 200, 'application/json'),
        answer('<!doctype html><html></html>', 200, 'text/html'),
        answer('User-agent: *\nDisallow:\n'),
        answer('hello'),
      ].map((report) => {
        const [finding] = llmsFindings(report);
        expect(finding).toMatchObject({ id: 'llms-txt-found', level: 'fail' });
        return finding!.message;
      }),
    );
    expect(sentences.size).toBe(7);
  });
});
