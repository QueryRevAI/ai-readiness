import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createFixtureTextFetcher, tableResolver } from '../net/testing';
import type { TextFetcher } from '../net/fetch-text';
import { runCli } from './main';
import type { CliContext, ExitCode, FileRead } from './types';

// Test helper for the command line: a local fixture site on 127.0.0.1 that answers for several
// host names (by `Host`), an in-memory file system, and a context that records what is printed.
// Nothing here reaches the internet: the fixture guard allows one loopback address and one port.

export interface Answer {
  readonly status?: number;
  readonly type?: string;
  readonly body?: string | Buffer;
  readonly headers?: Record<string, string>;
}
export type Site = Record<string, Answer | undefined>;

export interface RunOptions {
  readonly tty?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly offersPrivateNetwork?: boolean;
}

export interface RunResult {
  readonly code: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Rig {
  readonly port: number;
  sites: Record<string, Site>;
  readonly files: Map<string, string>;
  readonly seen: { host: string; path: string; agent: string }[];
  readonly fetcherCalls: { allowPrivateNetwork: boolean }[];
  /** Runs the command line with the fixture fetcher. */
  run(argv: readonly string[], options?: RunOptions): Promise<RunResult>;
  /** Runs with a context whose `createFetcher` throws. */
  runBroken(argv: readonly string[]): Promise<RunResult>;
  /** The address of a fixture host. */
  url(host?: string, path?: string): string;
  /** Replaces the port of the fixture with `PORT`, for golden files. */
  normalize(text: string): string;
  close(): Promise<void>;
}

const enoent = (path: string): Error =>
  Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });

export async function startRig(): Promise<Rig> {
  const rig: { sites: Record<string, Site> } = { sites: {} };
  const seen: Rig['seen'] = [];
  const files = new Map<string, string>();
  const fetcherCalls: Rig['fetcherCalls'] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const host = (req.headers.host ?? '').split(':')[0]!;
    const path = req.url ?? '/';
    seen.push({ host, path, agent: String(req.headers['user-agent'] ?? '') });
    const answer = rig.sites[host]?.[path];
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
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const resolver = tableResolver({
    'site.test': ['127.0.0.1'],
    'www.site.test': ['127.0.0.1'],
    'other.test': ['127.0.0.1'],
  });

  const readFile = (path: string, maxBytes: number): Promise<FileRead> => {
    const text = files.get(path);
    if (text === undefined) return Promise.reject(enoent(path));
    const bytes = Buffer.from(text, 'utf8');
    return Promise.resolve({
      bytes: bytes.subarray(0, maxBytes),
      truncated: bytes.length > maxBytes,
    });
  };

  const makeContext = (
    options: RunOptions,
    out: string[],
    err: string[],
    createFetcher: CliContext['createFetcher'],
  ): CliContext => ({
    stdout: { write: (chunk) => out.push(chunk), isTTY: options.tty === true },
    stderr: { write: (chunk) => err.push(chunk) },
    env: options.env ?? {},
    ...(options.offersPrivateNetwork === undefined
      ? {}
      : { offersPrivateNetwork: options.offersPrivateNetwork }),
    readFile,
    writeFile: (path, text, overwrite) => {
      if (!overwrite && files.has(path)) {
        return Promise.reject(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }));
      }
      files.set(path, text);
      return Promise.resolve();
    },
    createFetcher,
  });

  const fixtureFetcher = (options: { allowPrivateNetwork: boolean }): TextFetcher => {
    fetcherCalls.push(options);
    return createFixtureTextFetcher({ port, resolver, hostIntervalMs: 0 });
  };

  const execute = async (
    argv: readonly string[],
    options: RunOptions,
    createFetcher: CliContext['createFetcher'],
  ): Promise<RunResult> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, makeContext(options, out, err, createFetcher));
    return { code, stdout: out.join(''), stderr: err.join('') };
  };

  return Object.assign(rig, {
    port,
    files,
    seen,
    fetcherCalls,
    run: (argv: readonly string[], options: RunOptions = {}) =>
      execute(argv, options, fixtureFetcher),
    runBroken: (argv: readonly string[]) =>
      execute(argv, {}, () => {
        throw new Error('boom');
      }),
    url: (host = 'site.test', path = '/') => `http://${host}:${port}${path}`,
    normalize: (text: string) => text.split(`:${port}`).join(':PORT'),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

const words = (count: number): string => 'word '.repeat(count);

export const ORG = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Fixture Co',
  url: 'https://site.test/',
  logo: 'https://site.test/logo.png',
  sameAs: ['https://www.linkedin.com/company/fixture', 'https://www.wikidata.org/wiki/Q1'],
};

export const GOOD_HOME = `<!doctype html><html><head><title>Fixture Co</title><meta name="description" content="Fixtures for tests."><script type="application/ld+json">${JSON.stringify(ORG)}</script></head><body><main><h1>Fixture</h1><p>${words(200)}</p><a href="/guide/start">Start</a><a href="/blog/post">Post</a></main></body></html>`;

export const LLMS =
  '# Fixture Co\n\n> A site for tests.\n\n## Guide\n\n- [Start](/guide/start): begin here\n- [Post](/blog/post): a post\n';

export const URLSET = (port: number): string =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://site.test:${port}/guide/start</loc></url><url><loc>http://site.test:${port}/blog/post</loc></url><url><loc>http://site.test:${port}/private/hidden</loc></url></urlset>`;

export const page = (title: string, description: string, extra = ''): string =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}">${extra}</head><body><main><h1>${title}</h1><p>${words(120)}</p></main></body></html>`;

/** A healthy site: robots.txt with a sitemap, a rich home page, llms.txt, a sitemap and pages. */
export function healthySite(port: number, extra: Site = {}): Site {
  return {
    '/robots.txt': {
      type: 'text/plain',
      body: `User-agent: *\nDisallow: /private\nSitemap: http://site.test:${port}/sitemap.xml\n`,
    },
    '/': { type: 'text/html; charset=utf-8', body: GOOD_HOME },
    '/llms.txt': { type: 'text/plain', body: LLMS },
    '/sitemap.xml': { type: 'application/xml', body: URLSET(port) },
    '/guide/start': {
      type: 'text/html',
      body: page('Getting started', 'Begin here with the first steps.'),
    },
    '/blog/post': { type: 'text/html', body: page('A post', 'What happened this week.') },
    '/private/hidden': { type: 'text/html', body: page('Hidden', 'Not for crawlers.') },
    ...extra,
  };
}
