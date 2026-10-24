import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createFixtureTextFetcher, tableResolver } from '@queryrev/ai-readiness/testing';
import type { TextFetcher } from '@queryrev/ai-readiness';

// A local fixture site on 127.0.0.1 that answers for host names by `Host`. The fixture fetcher's
// guard allows that one address and that one port, so no test reaches the internet.

export interface Answer {
  readonly status?: number;
  readonly type?: string;
  readonly body?: string;
}
export type Site = Record<string, Answer | undefined>;

export interface Rig {
  readonly port: number;
  sites: Record<string, Site>;
  readonly seen: { host: string; path: string; agent: string }[];
  /** How many fetchers the server asked for. */
  fetchers: number;
  readonly createFetcher: () => TextFetcher;
  url(host?: string, path?: string): string;
  close(): Promise<void>;
}

export async function startRig(): Promise<Rig> {
  const sites: Record<string, Site> = {};
  const seen: Rig['seen'] = [];
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
    });
    res.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const resolver = tableResolver({ 'site.test': ['127.0.0.1'], 'www.site.test': ['127.0.0.1'] });
  const rig: Rig = {
    port,
    sites,
    seen,
    fetchers: 0,
    createFetcher: () => {
      rig.fetchers += 1;
      return createFixtureTextFetcher({ port, resolver, hostIntervalMs: 0 });
    },
    url: (host = 'site.test', path = '/') => `http://${host}:${port}${path}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  return rig;
}

const words = (count: number): string => 'word '.repeat(count);

export const ROBOTS = (port: number): string =>
  `User-agent: *\nDisallow: /private\nSitemap: http://site.test:${port}/sitemap.xml\n`;

export const LLMS =
  '# Fixture Co\n\n> A site for tests.\n\n## Guide\n\n- [Start](/guide/start): begin here\n- [Post](/blog/post): a post\n';

export const page = (title: string, description: string): string =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}"></head><body><main><h1>${title}</h1><p>${words(120)}</p></main></body></html>`;

export const HOME = page('Fixture Co', 'Fixtures for tests.');

export const URLSET = (port: number): string =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://site.test:${port}/guide/start</loc></url><url><loc>http://site.test:${port}/blog/post</loc></url></urlset>`;

/** A small healthy site: robots.txt with a sitemap, a home page, llms.txt, a sitemap and pages. */
export function healthySite(port: number, extra: Site = {}): Site {
  return {
    '/robots.txt': { type: 'text/plain', body: ROBOTS(port) },
    '/': { type: 'text/html; charset=utf-8', body: HOME },
    '/llms.txt': { type: 'text/plain', body: LLMS },
    '/sitemap.xml': { type: 'application/xml', body: URLSET(port) },
    '/guide/start': {
      type: 'text/html',
      body: page('Getting started', 'Begin here with the first steps.'),
    },
    '/blog/post': { type: 'text/html', body: page('A post', 'What happened this week.') },
    ...extra,
  };
}
